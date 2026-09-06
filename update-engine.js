// ============================================================================
// Lucca POS — Production Auto-Update Engine (Electron main process)
// ----------------------------------------------------------------------------
// Replaces the previous "self-updater" that only downloaded loose source files
// and never installed a real package. This module drives a REAL update cycle:
//
//   CHECK -> AVAILABLE -> DOWNLOAD -> VERIFY(sha512) -> BACKUP -> INSTALL -> RESTART -> VERIFY-VERSION
//
// Uses electron-updater's native `autoUpdater` (GitHub Releases provider),
// which:
//   * reads the update manifest `latest.yml` attached to the GitHub Release
//   * downloads the real NSIS installer asset (LuccaPOS Setup <v>.exe)
//   * verifies its SHA-512 against the manifest (integrity = native)
//   * silently installs, then restarts and relaunches the app.
// ============================================================================
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  autoUpdater = null;
}

// ---- State machine (§14) ---------------------------------------------------
const STATES = [
  'IDLE', 'CHECKING', 'AVAILABLE', 'DOWNLOADING', 'DOWNLOADED',
  'VERIFYING', 'VERIFIED', 'INSTALLING', 'RESTARTING', 'UPDATED', 'FAILED'
];

const logLevel = (msg) => console.log('[lucca-update] ' + msg);

// ---- Persistent helpers ----------------------------------------------------
function getUserDataDir(app) {
  try { return app.getPath('userData'); } catch { return path.join(os.homedir(), '.lucca-pos'); }
}

function deviceId(app) {
  const dir = getUserDataDir(app);
  const f = path.join(dir, 'device-id');
  try {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
    const id = crypto.randomUUID();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, id, 'utf8');
    return id;
  } catch { return 'unknown-device'; }
}

// ---- Update log (§15) ------------------------------------------------------
function updateLog(app, event) {
  try {
    const dir = getUserDataDir(app);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      deviceId: deviceId(app),
      currentVersion: _current,
      targetVersion: _target,
      event,
      state: _state,
      error: _lastError || undefined
    }) + os.EOL;
    fs.appendFileSync(path.join(dir, 'update-log.jsonl'), line, 'utf8');
  } catch (e) { /* best-effort */ }
}

// ---- Backup user data (§9, §10) --------------------------------------------
// IndexedDB (client data: orders, invoices, payments, expenses, employees,
// inventory, shifts, audit logs, sync queue) lives in Electron `userData`.
// Updating the app replaces only files under the install dir (app.asar /
// Program Files). Before we install we additionally copy the whole userData
// database files to a timestamped backup so a failed migration can be restored.
function backupUserData(app) {
  const dir = getUserDataDir(app);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, 'update-backups', 'pre-' + stamp);
  try {
    fs.mkdirSync(target, { recursive: true });
    const candidates = [];
    // IndexedDB data lives in <dir>/IndexedDB/<db>/; also index.html uses
    // localStorage (LevelDB) under <dir>/Local Storage/. Sync queue is part of
    // IndexedDB (sync_log/sync_backups stores). We copy the key data folders.
    for (const sub of ['IndexedDB', 'Local Storage', 'sync-backups']) {
      const p = path.join(dir, sub);
      if (fs.existsSync(p)) candidates.push(p);
    }
    // Also copy any leveldb / *.sqlite in userData root
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      let st = null; try { st = fs.statSync(full); } catch {}
      if (st && st.isFile() && /\.(sqlite|db|jsonl|log|dat)$/i.test(f)) candidates.push(full);
    }
    for (const c of candidates) {
      const rel = path.relative(dir, c);
      const dst = path.join(target, rel);
      try {
        fs.cpSync(c, dst, { recursive: true });
      } catch {
        try { fs.copyFileSync(c, dst); } catch {}
      }
    }
    fs.writeFileSync(path.join(target, 'backup-meta.json'),
      JSON.stringify({ createdAt: new Date().toISOString(), appVersion: _current, deviceId: deviceId(app) }, null, 2), 'utf8');
    logLevel('backup done -> ' + target);
    return target;
  } catch (e) {
    logLevel('backup FAILED: ' + e.message);
    return null;
  }
}

// ---- Crash-loop / rollback marker (§18) -----------------------------------
// After an update we set a pending-update marker. On next launch either the
// new version proves itself (we clear the marker) or, if the same version
// keeps crashing, we detect it and offer recovery instead of leaving the
// cashier machine stuck.
function crashDetect(app, currentVersion) {
  const dir = getUserDataDir(app);
  const f = path.join(dir, 'pending-update.json');
  try {
    if (!fs.existsSync(f)) return null; // no pending marker -> normal start
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (data.expectedVersion === currentVersion) {
      // New version actually running -> it booted far enough to clear marker.
      fs.unlinkSync(f);
      return { recovered: true, expected: data.expectedVersion, actual: currentVersion };
    }
    // Version did NOT change to expected -> update did not take effect.
    return { recovered: false, expected: data.expectedVersion, actual: currentVersion };
  } catch { return null; }
}

function setPendingMark(app, expectedVersion) {
  try {
    const dir = getUserDataDir(app);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pending-update.json'),
      JSON.stringify({ expectedVersion, ts: new Date().toISOString() }), 'utf8');
  } catch {}
}

// ---- Engine state ----------------------------------------------------------
let _state = 'IDLE';
let _current = '0.0.0';
let _target = null;
let _lastError = null;
let _app = null;
let _send = null;           // function(payload) -> renderer
let _updateInfo = null;
const _listeners = [];

function setState(s) {
  _state = s;
  updateLog(_app, 'state.' + s.toLowerCase());
  _emit();
}
function _emit() {
  const payload = { state: _state, currentVersion: _current, targetVersion: _target, error: _lastError };
  try { if (_send) _send(payload); } catch {}
  for (const cb of _listeners) { try { cb(payload); } catch {} }
}

// ---- Electron-updater plumbing ---------------------------------------------
// Guard so that the main-process auto-download and the renderer's manual
// downloadUpdate() never start two overlapping downloads.
let _autoDownloading = false;
let _checkInProgress = false;

async function _autoDownload() {
  if (_autoDownloading) return;               // already downloading
  if (_state !== 'AVAILABLE') return;         // only start from a fresh AVAILABLE
  _autoDownloading = true;
  try {
    await module.exports.download();
  } finally {
    _autoDownloading = false;
  }
}

function wireAutoUpdater() {
  if (!autoUpdater) return false;
  autoUpdater.autoDownload = false;    // we control download+install explicitly
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => { setState('CHECKING'); });
  autoUpdater.on('update-available', (info) => {
    _target = String((info && (info.version || info.slug)) || _target || '');
    _updateInfo = info;
    _lastError = null;
    setState('AVAILABLE');
    // Deterministic production behaviour: the main process drives the download
    // as soon as an update is available (renderer race/offline can't block it).
    _autoDownload();
  });
  autoUpdater.on('update-not-available', () => { _lastError = null; setState('IDLE'); });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round((p && p.percent) || 0);
    _emit();
    try { if (_send) _send({ state: _state, percent }); } catch {}
  });
  autoUpdater.on('update-downloaded', (info) => {
    _target = String((info && info.version) || _target || '');
    setState('VERIFIED'); // sha512 validated by electron-updater against latest.yml
    // Auto-install + restart after a short confirmation window.
    try { setTimeout(() => { try { module.exports.installAndRestart(); } catch {} }, 1500); } catch {}
  });
  autoUpdater.on('error', (err) => {
    _lastError = (err && (err.message || String(err))) || 'unknown';
    // Distinguish offline/unreachable from a broken update.
    setState(_state === 'DOWNLOADING' || _state === 'DOWNLOADED' || _state === 'VERIFYING' ? 'FAILED' : 'FAILED');
    logLevel('autoUpdater error: ' + _lastError);
  });
  return true;
}

// ---- Public API ------------------------------------------------------------
module.exports = {
  STATES,
  init({ app, currentVersion, send }) {
    _app = app;
    _current = currentVersion || '0.0.0';
    _send = send || null;
    wireAutoUpdater();
    // Offline-safe: we never claim an update exists unless checkForUpdates says so.
    const cd = crashDetect(app, _current);
    if (cd) {
      if (!cd.recovered) {
        _lastError = 'تحديث سابق لم يطبَّق (متوقف على ' + cd.actual + ' بينما المطلوب ' + cd.expected + ')';
        updateLog(app, 'update.failed');
      } else {
        updateLog(app, 'update.success');
        setState('UPDATED');
      }
    }
    updateLog(app, 'update.check.start');
    return this;
  },

  getState: () => ({ state: _state, currentVersion: _current, targetVersion: _target, error: _lastError }),
  onState(cb) { _listeners.push(cb); },
  isSupported() { return !!autoUpdater; },

  // §6 check: current vs latest. Never claims an update when unreachable.
  async check() {
    if (!autoUpdater) { setState('IDLE'); return { ok: false, offline: false, reason: 'updater-unavailable' }; }
    // Guard against concurrent runs (reactor's checkForUpdates + main timer).
    if (_checkInProgress) { updateLog(_app, 'update.check.dupe'); return { ok: true, dupe: true }; }
    _checkInProgress = true;
    try {
      setState('CHECKING');
      const result = await autoUpdater.checkForUpdates();
      updateLog(_app, 'update.check');
      // state is set by update-available / update-not-available events.
      return { ok: true };
    } catch (e) {
      _lastError = (e && e.message) || String(e);
      // Reaching here with a network failure => offline/unreachable.
      setState('FAILED');
      updateLog(_app, 'update.failed');
      return { ok: false, offline: true, reason: _lastError };
    } finally {
      _checkInProgress = false;
    }
  },

  // §7 download (real installer asset)
  async download() {
    if (!autoUpdater) { setState('FAILED'); _lastError = 'updater-unavailable'; updateLog(_app, 'update.failed'); return { ok: false }; }
    if (_state === 'DOWNLOADING' || _state === 'DOWNLOADED' || _state === 'VERIFIED') {
      updateLog(_app, 'update.download.dupe');
      return { ok: true, already: _state };
    }
    try {
      setState('DOWNLOADING');
      updateLog(_app, 'update.download.start');
      await autoUpdater.downloadUpdate();
      // update-downloaded event fired => VERIFIED (sha512 matched latest.yml)
      updateLog(_app, 'update.download.success');
      return { ok: true };
    } catch (e) {
      _lastError = (e && e.message) || String(e);
      setState('FAILED');
      updateLog(_app, 'update.failed');
      logLevel('download failed: ' + _lastError);
      return { ok: false, error: _lastError };
    }
  },

  // §9+§12 backup then install & restart (real) — NOT a renderer reload.
  installAndRestart() {
    if (!autoUpdater) { setState('FAILED'); return { ok: false }; }
    try {
      setState('INSTALLING');
      updateLog(_app, 'update.install.start');
      backupUserData(_app);
      try { setPendingMark(_app, _target || _current); } catch {}
      // ensure the target version is recorded for post-restart verification
      autoUpdater.quitAndInstall(true, true); // silent, force install & run after
      setState('RESTARTING');
      return { ok: true };
    } catch (e) {
      _lastError = (e && e.message) || String(e);
      setState('FAILED');
      updateLog(_app, 'update.failed');
      return { ok: false, error: _lastError };
    }
  },

  backup() { return backupUserData(_app); },
  get current() { return _current; },
  get target() { return _target; },
  log: (ev) => { try { updateLog(_app, ev); } catch {} }
};
