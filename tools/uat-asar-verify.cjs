const fs = require('fs');
const path = require('path');
const os = require('os');

function findModule(prefixCandidates, name) {
  for (const c of prefixCandidates) {
    const p = path.join(c, 'node_modules', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  const repo = 'C:\\Users\\Acer\\OneDrive\\Desktop\\Lucca_menu-';
  // find the two cands of shipped asar + first NODE_PATH-compatible asar module
  const cands = [
    path.join(repo, 'dist', 'LuccaPOS-win32-x64', 'resources', 'app.asar'),
    path.join(repo, 'dist', 'win-unpacked', 'resources', 'app.asar')
  ].filter(p => fs.existsSync(p));

  // discover asar module (repo deps ship @electron/asar under app-builder-lib or electron-builder)
  const nodePrefix = path.join(repo, 'node_modules');
  await npmList(nodePrefix);
})();

function npmList(root) {
  return new Promise((res) => {
    const { execFile } = require('child_process');
    execFile('cmd.exe', ['/c', 'npm.cmd', 'ls', '@electron/asar', 'asar', '--prefix', '"' + 'C:\\Users\\Acer\\OneDrive\\Desktop\\Lucca_menu-' + '"'], { cwd: 'C:\\Users\\Acer\\OneDrive\\Desktop\\Lucca_menu-' }, (e, so, se) => {
      console.log('npm --prefix ls asar ::');
      console.log(String(so || '') + String(se || ''));
      res();
    });
  });
}
