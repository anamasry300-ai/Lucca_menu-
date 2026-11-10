/**
 * Lucca POS — Force Update Manager
 * يدير منطق التحديث الإجباري بناءً على إعدادات Supabase.
 * يحمي النافذة من الإغلاق أو التجاوز (Alt+F4، زر الإغلاق، التجاوز).
 */
'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');
const updateEngine = require('./update-engine');
const { checkUpdateRequired } = require('./supabase-config');

let forceUpdateWindow = null;
let mainWindowRef = null;
let isForceUpdateActive = false;
let appConfigResult = null;

function forceUpdateLog(event, data = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    currentVersion: app.getVersion ? app.getVersion() : 'unknown',
    ...data
  }) + '\n';
  try {
    const fs = require('fs');
    const os = require('os');
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'force-update-log.jsonl'), line, 'utf8');
  } catch (e) {
    console.error('[force-update] log failed:', e.message);
  }
}

function createForceUpdateWindow(config) {
  if (forceUpdateWindow && !forceUpdateWindow.isDestroyed()) {
    forceUpdateWindow.focus();
    return forceUpdateWindow;
  }

  forceUpdateWindow = new BrowserWindow({
    width: 600,
    height: 450,
    minWidth: 500,
    minHeight: 380,
    title: 'تحديث أمني إلزامي',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false
  });

  const hashData = encodeURIComponent(JSON.stringify({
    message: config.message || 'تحديث ضروري',
    currentVersion: config.currentVersion,
    minRequiredVersion: config.minRequiredVersion,
    latestVersion: config.latestVersion,
    releaseDate: config.releaseDate
  }));

  forceUpdateWindow.loadFile(path.join(__dirname, 'renderer', 'update-required.html'), {
    hash: hashData
  });

  // منع الإغلاق عند النقر على X أو Alt+F4 — لا نسمح بالخروج دون تحديث
  forceUpdateWindow.on('close', (event) => {
    if (isForceUpdateActive) {
      event.preventDefault();
      forceUpdateWindow.hide();
      return false;
    }
  });

  forceUpdateWindow.on('closed', () => {
    forceUpdateWindow = null;
    if (isForceUpdateActive && !mainWindowRef) {
      // نبقى في وضع التحديث الإجباري، لا نفتح النافذة الرئيسية
    }
  });

  forceUpdateWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return forceUpdateWindow;
}

function closeForceUpdateWindow() {
  if (forceUpdateWindow && !forceUpdateWindow.isDestroyed()) {
    forceUpdateWindow.close();
  }
  forceUpdateWindow = null;
  isForceUpdateActive = false;
}

async function checkForceUpdate(mainWindow) {
  mainWindowRef = mainWindow;
  const currentVersion = app.getVersion ? app.getVersion() : '0.0.0';

  forceUpdateLog('update.check.start', { currentVersion });

  try {
    const result = await checkUpdateRequired(currentVersion);
    appConfigResult = result;

    forceUpdateLog('update.check.result', {
      required: result.required,
      currentVersion: result.currentVersion,
      minRequiredVersion: result.minRequiredVersion,
      latestVersion: result.latestVersion,
      reason: result.reason,
      failClosed: result.failClosed
    });

    if (result.required) {
      isForceUpdateActive = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      createForceUpdateWindow(result);
      return { required: true, config: result };
    }

    return { required: false, config: result };
  } catch (e) {
    forceUpdateLog('update.check.error', { error: e.message });
    // Fail Closed: في حالة أي خطأ، إظهار نافذة التحديث الإجباري
    isForceUpdateActive = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    const fallbackConfig = {
      message: 'تعذر التحقق من التحديث. يرجى التحقق من اتصال الإنترنت وإعادة المحاولة.',
      currentVersion,
      minRequiredVersion: null,
      latestVersion: null,
      releaseDate: null
    };
    createForceUpdateWindow(fallbackConfig);
    return { required: true, config: fallbackConfig, error: e.message };
  }
}

async function performForceUpdate() {
  if (!updateEngine) {
    forceUpdateLog('update.perform.error', { error: 'updater-unavailable' });
    return { ok: false, error: 'updater-unavailable' };
  }

  forceUpdateLog('update.perform.start', { targetVersion: appConfigResult ? appConfigResult.latestVersion : null });

  try {
    const checkResult = await updateEngine.check();
    if (!checkResult.ok) {
      forceUpdateLog('update.perform.check-failed', { error: checkResult.reason });
      return { ok: false, error: checkResult.reason || 'check-failed' };
    }

    const downloadResult = await updateEngine.download();
    if (!downloadResult.ok) {
      forceUpdateLog('update.perform.download-failed', { error: downloadResult.error });
      return { ok: false, error: downloadResult.error || 'download-failed' };
    }

    const installResult = updateEngine.installAndRestart();
    forceUpdateLog('update.perform.install', { ok: !!installResult });
    return installResult;
  } catch (e) {
    forceUpdateLog('update.perform.exception', { error: e.message });
    return { ok: false, error: e.message };
  }
}

function registerForceUpdateIPC() {
  const { ipcMain } = require('electron');

  ipcMain.handle('force-update-check', async () => {
    return { active: isForceUpdateActive, config: appConfigResult };
  });

  ipcMain.handle('force-update-perform', async () => {
    return await performForceUpdate();
  });

  ipcMain.handle('force-update-get-version', () => {
    return { version: app.getVersion ? app.getVersion() : '0.0.0' };
  });
}

module.exports = {
  checkForceUpdate,
  performForceUpdate,
  closeForceUpdateWindow,
  registerForceUpdateIPC,
  isForceUpdateActive: () => isForceUpdateActive,
  get appConfigResult() { return appConfigResult; }
};
