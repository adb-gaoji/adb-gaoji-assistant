const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('Android application installs use the progress dialog', () => {
  assert.match(html, /id="installProgressDialog"/);
  for (const action of [
    'install-apk', 'install-apk-single', 'install-apk-batch', 'install-framework',
    'install-clone-tools', 'install-users-manager', 'install-aiwanji-toolbox',
    'install-magisk', 'gms-install-builtin', 'gms-import-local'
  ]) {
    assert.match(renderer, new RegExp(`'${action}'`));
  }
});

test('successful installs show confirmation for three seconds', () => {
  assert.match(renderer, /成功安装/);
  assert.match(renderer, /3000/);
  assert.match(styles, /install-progress-slide/);
  assert.match(styles, /var\(--success\)/);
});

test('V20.3.2 preserves the selected left navigation and modular home layout', () => {
  assert.match(html, /<aside class="sidebar app-header">/);
  assert.match(html, /class="command-bar"/);
  assert.match(html, /class="nav-list" aria-label="功能导航"/);
  assert.match(html, /data-ui-version="20\.3\.2"/);
  assert.match(styles, /#page-device\.active \{ display: grid/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(330px, \.92fr\)/);
});

test('V20.3.2 keeps shared controls, cards, tables, and dialog contracts', () => {
  assert.match(styles, /table, \.ui-table/);
  assert.match(styles, /\.modal-heading/);
  assert.match(styles, /\.primary-button/);
  assert.match(styles, /\.secondary-button/);
  assert.match(styles, /@media \(max-width: 680px\)/);
});

test('V20.3.2 places the footer flash button at the end', () => {
  const footer = html.match(/<div class="flash-footer-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(footer.indexOf('重新解析') < footer.indexOf('打开刷机包目录'));
  assert.ok(footer.indexOf('打开刷机包目录') < footer.indexOf('打开 MotoFlashPro'));
  assert.ok(footer.indexOf('打开 MotoFlashPro') < footer.lastIndexOf('开始刷机'));
});
