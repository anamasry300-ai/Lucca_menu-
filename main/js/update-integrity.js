/**
 * Lucca POS — Update Integrity & Security Module (Phase 1)
 * يوفر التحقق منintegrity الحزمة، حماية من الهجمات المعاكسة (rollback/downgrade),
 * اكتشاف التحميلات التالفة، إعادة المحاولة مع backoff أسي، ومهلة انتظار.
 *
 * @module update-integrity
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

/**
 * الحد الأدنى للإصدار المسموح (يمنع الهجمات المعاكسة / downgrade attacks)
 * أي إصدار أقل من هذا القيمة يُرفض حتى لو كان متاحاً على السيرفر.
 */
const MIN_ALLOWED_VERSION = '1.3.6';

/**
 * مدة المهلة الافتراضية لعملية التحميل (بالمللي ثانية)
 */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300000; // 5 دقائق

/**
 * عدد مرات المحاولة القصوى للتحميل الفاشل
 */
const MAX_DOWNLOAD_RETRIES = 3;

/**
 * التأخير الأساسي للأ-backoff الأسي (بالمللي ثانية)
 */
const BASE_BACKOFF_MS = 2000; // 2 ثانية

// ---- حالة الوحدة ----
let _currentVersion = '0.0.0';
let _targetVersion = null;
let _lastDownloadAttempt = 0;
let _retryCount = 0;
let _logDir = null;

/**
 * مقارنة إصدارات semver بسيطة
 * @param {string} v1 - الإصدار الأول
 * @param {string} v2 - الإصدار الثاني
 * @returns {number} -1 إذا v1 < v2, 0 إذا متساويان, 1 إذا v1 > v2
 */
function compareVersions(v1, v2) {
  const normalize = (v) => String(v || '0.0.0').split('.').map(Number);
  const a = normalize(v1);
  const b = normalize(v2);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * التحقق من أن الإصدار المستهدف لا يقل عن الحد الأدنى المسموح (حماية من downgrade)
 * @param {string} targetVersion - الإصدار المستهدف
 * @returns {boolean} - true إذا كان الإصدار آمناً (ليسDowngrade)
 */
function isVersionSafe(targetVersion) {
  if (!targetVersion) return false;
  return compareVersions(targetVersion, MIN_ALLOWED_VERSION) >= 0;
}

/**
 * حساب SHA512 لملف
 * @param {string} filePath - مسار الملف
 * @returns {Promise<string>} - بصمة SHA512 بالhexadecimal
 */
async function computeFileSHA512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * التحقق منintegrity حزمة التحديث ضد latest.yml
 * @param {Object} updateInfo - معلومات التحديث من electron-updater
 * @param {string} downloadedFilePath - مسار الملف المحمل
 * @returns {Promise<{valid: boolean, error?: string, sha512?: string}>}
 */
async function validateUpdatePackage(updateInfo, downloadedFilePath) {
  try {
    // 1. التحقق من وجود الملف
    if (!fs.existsSync(downloadedFilePath)) {
      return { valid: false, error: 'ملف التحديث غير موجود' };
    }

    // 2. حساب SHA512 للملف المحمل
    const computedSHA512 = await computeFileSHA512(downloadedFilePath);

    // 3. الحصول على البصمة المتوقعة من latest.yml
    const expectedSHA512 = updateInfo && updateInfo.sha512
      ? String(updateInfo.sha512)
      : (updateInfo && updateInfo.files && Array.isArray(updateInfo.files)
          ? updateInfo.files.find((f) => f.url && f.url.includes(downloadedFilePath))?.sha512
          : null);

    if (!expectedSHA512) {
      return { valid: false, error: 'بصمة SHA512 غير متوفرة في latest.yml' };
    }

    // 4. مقارنة البصمات
    if (computedSHA512.toLowerCase() !== expectedSHA512.toLowerCase()) {
      return {
        valid: false,
        error: 'بصمة SHA512 غير مطابقة — الملف قد يكون تالفاً أو مخترقاً',
        computed: computedSHA512,
        expected: expectedSHA512
      };
    }

    // 5. التحقق من أن الإصدار المستهدف ليسDowngrade
    const targetVersion = updateInfo && updateInfo.version ? String(updateInfo.version) : _targetVersion;
    if (!isVersionSafe(targetVersion)) {
      return {
        valid: false,
        error: `الإصدار المستهدف ${targetVersion} أقل من الحد الأدنى المسموح ${MIN_ALLOWED_VERSION} — هجوم downgrade محتمل`
      };
    }

    return {
      valid: true,
      sha512: computedSHA512,
      version: targetVersion
    };
  } catch (err) {
    return {
      valid: false,
      error: `خطأ في التحقق منintegrity: ${err.message}`
    };
  }
}

/**
 * اكتشاف ما إذا كان الملف تالفاً (الحجم، الامتداد، posibilidad أن يكون نصاً وليس ملفاً تنفيذياً)
 * @param {string} filePath - مسار الملف
 * @returns {Promise<{corrupt: boolean, reason?: string}>}
 */
async function detectCorruptedDownload(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { corrupt: true, reason: 'الملف غير موجود' };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { corrupt: true, reason: 'حجم الملف صفر' };
    }

    // قراءة أول few بايتات للتحقق من أنها ليست HTML/نص (في حالة خطأ 404 يُعاد HTML)
    const headerBuffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, headerBuffer, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }

    const headerText = headerBuffer.toString('ascii', 0, 16);
    if (/^(<!DOCTYPE|<html|<HEAD|<body|<script|{|\[")/i.test(headerText.trim())) {
      return { corrupt: true, reason: 'يبدو أن الملف استجابة HTML أو JSON وليس ملفاً تنفيذياً' };
    }

    // الملفات التنفيذية لنظام ويندوز تبدأ بـ MZ (0x4D 0x5A)
    if (headerBuffer[0] !== 0x4D || headerBuffer[1] !== 0x5A) {
      return { corrupt: true, reason: 'توقيع الملف التنفيذي غير صالح (غير ملف Windows EXE)' };
    }

    return { corrupt: false };
  } catch (err) {
    return { corrupt: true, reason: `خطأ في فحص الملف: ${err.message}` };
  }
}

/**
 * تنفيذ تأخير (sleep) لمدة محددة
 * @param {number} ms - المدة بالمللي ثانية
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * حساب وقت الانتظار باستخدام backoff الأسي مع تذبذب (jitter)
 * @param {number} attempt - رقم المحاولة الحالية (ابتداءً من 0)
 * @returns {number} - وقت الانتظار بالمللي ثانية
 */
function calculateBackoff(attempt) {
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // تذبذب حتى ثانية واحدة
  return Math.min(exponential + jitter, 30000); // الحد الأقصى 30 ثانية
}

/**
 * تحميل حزمة التحديث مع إعادة المحاولة وbackoff الأسي ومهلة انتظار
 * @param {Function} downloadFn - دالة التحميل الفعلية (تُعيد Promise)
 * @param {Object} options - خيارات التحميل
 * @param {number} options.timeoutMs - مهلة التحميل (افتراضي 5 دقائق)
 * @param {number} options.maxRetries - أقصى عدد محاولات (افتراضي 3)
 * @param {Function} options.onProgress - دالة ردع للاستدعاء عند تقدم التحميل
 * @returns {Promise<{ok: boolean, error?: string, attempt?: number}>}
 */
async function downloadWithRetry(downloadFn, options = {}) {
  const { timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, maxRetries = MAX_DOWNLOAD_RETRIES, onProgress } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    _retryCount = attempt;
    _lastDownloadAttempt = Date.now();

    try {
      // إعداد مهلة انتظار للتحميل
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`انتهت مهلة التحميل بعد ${timeoutMs} مللي ثانية`)), timeoutMs)
      );

      const result = await Promise.race([downloadFn(onProgress), timeoutPromise]);

      if (result && result.ok === false) {
        lastError = result.error || 'فشل التحميل';
        if (attempt < maxRetries) {
          const waitMs = calculateBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
        return { ok: false, error: lastError, attempt };
      }

      return { ok: true, attempt };
    } catch (err) {
      lastError = err.message || String(err);
      if (attempt < maxRetries) {
        const waitMs = calculateBackoff(attempt);
        await sleep(waitMs);
        continue;
      }
      return { ok: false, error: lastError, attempt };
    }
  }

  return { ok: false, error: lastError || 'فشل غير معروف في التحميل', attempt: maxRetries };
}

/**
 * تهيئة وحدة integrity
 * @param {Object} opts - خيارات التهيئة
 * @param {string} opts.currentVersion - الإصدار الحالي للتطبيق
 * @param {string} opts.logDir - دليل السجلات (اختياري)
 */
function init(opts = {}) {
  _currentVersion = opts.currentVersion || '0.0.0';
  _logDir = opts.logDir || null;
}

/**
 * تسجيل حدث في سجل التحديث
 * @param {string} event - اسم الحدث
 * @param {Object} data - بيانات إضافية
 */
function integrityLog(event, data = {}) {
  if (!_logDir) return;
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      currentVersion: _currentVersion,
      targetVersion: _targetVersion,
      ...data
    }) + '\n';
    fs.mkdirSync(_logDir, { recursive: true });
    fs.appendFileSync(path.join(_logDir, 'update-integrity.log'), line, 'utf8');
  } catch (e) {
    // أفضل جهد — لا نريد أن يمنع الفشل في السجيل من الاستمرار
  }
}

/**
 * الحصول على حالة الوحدة للتشخيص
 * @returns {Object}
 */
function getState() {
  return {
    currentVersion: _currentVersion,
    targetVersion: _targetVersion,
    minAllowedVersion: MIN_ALLOWED_VERSION,
    retryCount: _retryCount,
    lastDownloadAttempt: _lastDownloadAttempt,
    isVersionSafe: isVersionSafe(_targetVersion)
  };
}

module.exports = {
  MIN_ALLOWED_VERSION,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  MAX_DOWNLOAD_RETRIES,
  BASE_BACKOFF_MS,
  compareVersions,
  isVersionSafe,
  computeFileSHA512,
  validateUpdatePackage,
  detectCorruptedDownload,
  downloadWithRetry,
  init,
  integrityLog,
  getState
};
