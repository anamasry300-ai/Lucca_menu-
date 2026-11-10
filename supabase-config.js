/**
 * Lucca POS — Supabase App Config Service
 * يقرأ إعدادات التحديث الإجباري من جدول app_config في Supabase.
 * سلوك Fail Closed: إذا تعذر الاتصال، يُعتبر التحديث مطلوباً (الحماية أولاً).
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://uudimvcdkaacqaxgajbk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZGltdmNka2FhY3FheGdhamJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzQ4MTYsImV4cCI6MjEwMjgxMDgxNn0.WrwCUlqWW2ib7D8T41DNzUbybo4FHnNQ1AIBTZr2ZlM';

  let _supabase = null;

  function initSupabase() {
    if (typeof window === 'undefined' || !window.supabase) return null;
    if (!_supabase) {
      _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _supabase;
  }

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

  async function getAppConfig() {
    const client = initSupabase();
    if (!client) {
      return { ok: false, error: 'supabase-unavailable', config: null, failClosed: true };
    }

    try {
      const { data, error } = await client
        .from('app_config')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        return { ok: false, error: error.message, config: null, failClosed: true };
      }

      return {
        ok: true,
        error: null,
        config: data || null,
        failClosed: false
      };
    } catch (e) {
      return { ok: false, error: e.message, config: null, failClosed: true };
    }
  }

  async function checkUpdateRequired(currentVersion) {
    const result = await getAppConfig();

    // Fail Closed: إذا تعذر جلب الإعدادات من Supabase، اعتبر التحديث مطلوباً
    if (!result.ok || result.failClosed || !result.config) {
      return {
        required: true,
        reason: result.error || 'no-config',
        currentVersion,
        minRequiredVersion: null,
        latestVersion: null,
        message: 'لا يمكن التحقق من إعدادات التحديث. يرجى التحقق من اتصال الإنترنت.',
        releaseDate: null,
        updateRequired: true,
        failClosed: true
      };
    }

    const config = result.config;
    const minRequired = config.min_required_version || '0.0.0';
    const latest = config.latest_version || '0.0.0';
    const isRequired = config.update_required === true;
    const isOutdated = compareVersions(currentVersion, minRequired) < 0;

    return {
      required: isRequired && isOutdated,
      reason: null,
      currentVersion,
      minRequiredVersion: minRequired,
      latestVersion: latest,
      message: config.update_message || 'تحديث ضروري للتطبيق',
      releaseDate: config.release_date,
      updateRequired: config.update_required,
      failClosed: false
    };
  }

  const exports = {
    getAppConfig,
    checkUpdateRequired,
    compareVersions,
    initSupabase
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else if (typeof window !== 'undefined') {
    window.LuccaAppConfig = exports;
  }
})();
