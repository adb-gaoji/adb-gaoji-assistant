const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
const release = fs.readFileSync(path.join(root, 'scripts', 'release.ps1'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('V20.3.0 exposes task center and unified risk confirmation UI', () => {
  assert.match(html, /id="taskCenterDialog"/);
  assert.match(html, /id="riskConfirmDialog"/);
  assert.match(html, /id="openTaskCenter"/);
  assert.match(renderer, /function beginTask\(/);
  assert.match(renderer, /function finishTask\(/);
  assert.match(renderer, /function askRiskConfirmation\(/);
  assert.match(renderer, /已有任务正在执行/);
});

test('V20.3.0 provides searchable, copyable, and exportable logs', () => {
  assert.match(html, /id="logSearch"/);
  assert.match(html, /id="copyLog"/);
  assert.match(html, /id="exportLog"/);
  assert.match(renderer, /function renderLog\(/);
  assert.match(preload, /copyLog/);
  assert.match(preload, /exportLog/);
  assert.match(main, /ipcMain\.handle\('log:copy'/);
  assert.match(main, /ipcMain\.handle\('log:export'/);
});

test('release script archives the current package version and verifies a single installed window', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.scripts['release:install'], 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1');
  assert.match(release, /ADB搞机助手_V\$\{version\}_安装包\.exe/);
  assert.match(release, /Desktop.*ADB搞机助手/);
  assert.match(release, /Visible windows/);
  assert.match(main, /已有任务正在执行/);
});
