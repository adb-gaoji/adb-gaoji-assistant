const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseDiskStats, parseStorageFileRows } = require('../src/app_package_query');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const appPackageQuery = fs.readFileSync(path.join(root, 'src', 'app_package_query.js'), 'utf8');

test('application list has a bounded independent scroll region', () => {
  assert.match(html, /id="appManagerList"[^>]*tabindex="0"/);
  assert.match(styles, /\.app-manager-dialog\[open\]\s*\{\s*display:\s*grid/);
  assert.match(styles, /\.app-manager-list\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});

test('application list preserves scroll position across rerenders and clamps only to available content', () => {
  assert.match(renderer, /listScrollTop:\s*0/);
  assert.match(renderer, /const previousScrollTop = Math\.max\(0, Number\(appManagerState\.listScrollTop\)/);
  assert.match(renderer, /const maxScrollTop = Math\.max\(0, list\.scrollHeight - list\.clientHeight\)/);
  assert.match(renderer, /list\.scrollTop = Math\.min\(previousScrollTop, maxScrollTop\)/);
  assert.match(renderer, /appManagerState\.listScrollTop = event\.currentTarget\.scrollTop/);
  assert.match(renderer, /\$\('appManagerList'\)\.addEventListener\('scroll'/);
});

test('application list supports name, size, type, and state sorting', () => {
  assert.match(html, /id="appManagerSort"/);
  for (const option of ['name-asc', 'name-desc', 'size-desc', 'size-asc', 'type-user', 'type-system', 'state-frozen', 'state-enabled']) {
    assert.match(html, new RegExp(`value="${option}"`));
    assert.match(renderer, new RegExp(`'${option}'`));
  }
  assert.match(renderer, /appManagerState\.sort = event\.target\.value/);
  assert.match(renderer, /app-list-size/);
});

test('application list supports selection and guarded batch actions', () => {
  assert.match(html, /id="selectAllVisibleApps"/);
  assert.match(html, /id="selectedAppCount"/);
  for (const action of ['export', 'uninstall', 'freeze', 'unfreeze']) {
    assert.match(html, new RegExp(`data-app-batch-action="${action}"`));
  }
  assert.match(renderer, /selectedPackages:\s*new Set\(\)/);
  assert.match(renderer, /function eligibleBatchApps\(/);
  assert.match(renderer, /function runAppBatchAction\(/);
  assert.match(renderer, /function updateTaskProgress\(/);
  assert.match(renderer, /任务进度/);
  assert.match(renderer, /beginTask\(config\.label, config\.actionId, apps\.length\)/);
  assert.match(renderer, /已有任务正在执行/);
  assert.match(renderer, /const target = `\$\{apps\.length\} 个应用/);
  assert.match(renderer, /askRiskConfirmation\(\{ message, action: config\.label, target \}\)/);
  for (const action of ['export-apks-batch', 'uninstall-packages-batch', 'freeze-apps-user0-batch', 'unfreeze-apps-user0-batch']) {
    assert.match(actions, new RegExp(`handlers\\['${action}'\\]`));
  }
});

test('application and storage scans are represented as conflict-protected tasks', () => {
  assert.match(renderer, /beginTask\('扫描应用列表', 'list-packages'\)/);
  assert.match(renderer, /beginTask\('扫描存储空间', 'storage-summary'\)/);
  assert.match(renderer, /allowActiveTask = false/);
  assert.match(renderer, /loadStorageSummary\(\{ allowActiveTask: true \}\)/);
  assert.match(renderer, /loadAppManager\(appManagerState\.selectedPackage, \{ allowActiveTask: true \}\)/);
  assert.match(actions, /\[任务进度\] \$\{index \+ 1\}\/\$\{packages\.length\}/);
});

test('application actions open the selectable manager instead of package-name forms', () => {
  for (const action of ['export-apk', 'uninstall-package', 'clear-app-data', 'freeze-app-user0', 'unfreeze-app-user0']) {
    assert.match(renderer, new RegExp(`'${action}': \\{ view:`));
    assert.doesNotMatch(renderer, new RegExp(`'${action}': \\{ title:`));
  }
  assert.match(renderer, /openAppManager\(appManagerEntry\.view, appManagerEntry\.intent\)/);
});

test('storage cleanup exposes real categories and ADB operations', () => {
  for (const category of ['apps', 'photos', 'videos', 'cache', 'junk']) {
    assert.match(html, new RegExp(`data-storage-category="${category}"`));
  }
  assert.match(renderer, /window\.gaoji\.run\('storage-summary'/);
  assert.match(actions, /pm', 'trim-caches', '999G'/);
  assert.match(actions, /\/sdcard\/DCIM/);
  assert.match(actions, /\/sdcard\/Movies/);
  assert.match(actions, /\/sdcard\/Download/);
  assert.match(html, /data-storage-meta/);
  assert.match(renderer, /details\.count === null/);
  assert.match(renderer, /details\.paths\.join/);
  assert.match(renderer, /扫描结果：\$\{scannedTarget\}/);
  assert.match(renderer, /释放 \$\{formatBytes\(released\)\}/);
  assert.match(actions, /const cleanupResult/);
  assert.match(actions, /deletedCount/);
  assert.match(actions, /const removeStorageFiles/);
  assert.match(actions, /\['shell', 'rm', '-f', '--', file\.path\]/);
});

test('diskstats parser returns category and per-package byte counts', () => {
  const parsed = parseDiskStats(`
    Data-Free: 1024K / 4096K total = 25% free
    App Size: 100
    App Data Size: 200
    App Cache Size: 50
    Photos Size: 300
    Videos Size: 400
    Downloads Size: 500
    Package Names: ["com.example.app"]
    App Sizes: [10]
    App Data Sizes: [20]
    Cache Sizes: [5]
  `);
  assert.equal(parsed.totalBytes, 4096 * 1024);
  assert.equal(parsed.freeBytes, 1024 * 1024);
  assert.equal(parsed.appsBytes, 350);
  assert.equal(parsed.photosBytes, 300);
  assert.equal(parsed.videosBytes, 400);
  assert.equal(parsed.downloadsBytes, 500);
  assert.deepEqual(parsed.packages['com.example.app'], { codeBytes: 10, dataBytes: 20, cacheBytes: 5, totalBytes: 35 });
});

test('public storage scan parser returns file paths and byte totals', () => {
  const parsed = parseStorageFileRows(`
4096:/sdcard/DCIM/photo.jpg
8192:/sdcard/Movies/video.mp4
1024:/sdcard/Download/update.apk
  `);
  assert.deepEqual(parsed, [
    { bytes: 4096, path: '/sdcard/DCIM/photo.jpg' },
    { bytes: 8192, path: '/sdcard/Movies/video.mp4' },
    { bytes: 1024, path: '/sdcard/Download/update.apk' }
  ]);
  assert.match(appPackageQuery, /findFileStatsArgs/);
  assert.match(appPackageQuery, /\/sdcard\/DCIM\/\.thumbnails/);
});
