const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createAppPackageQuery, parsePackageRows } = require('../src/app_package_query');
const { createActionHandlers } = require('../src/action_handlers');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

test('package query parser decodes metadata and frozen state', () => {
  const label = Buffer.from('相机').toString('base64');
  const version = Buffer.from('1.2.3').toString('base64');
  const [app] = parsePackageRows(`Row: 1 package_name=com.example.camera, label_b64=${label}, version_name_b64=${version}, is_system=0, enabled=0, suspended=0, storage=external, launchable=1`);
  assert.deepEqual(app, {
    label: '相机',
    packageName: 'com.example.camera',
    versionName: '1.2.3',
    system: false,
    enabled: false,
    suspended: false,
    frozen: true,
    storage: 'external',
    launchable: true
  });
});

test('package query rejects invalid serial before invoking ADB', async () => {
  let calls = 0;
  const query = createAppPackageQuery({
    adb: async () => { calls += 1; },
    getResourceRoot: () => root
  });
  const result = await query.run({ serial: 'invalid serial' });
  assert.equal(result.code, 2);
  assert.equal(calls, 0);
});

test('storage file browser reads only the requested public category', async () => {
  const calls = [];
  const handlers = createActionHandlers({
    app: { getPath: () => root },
    dialog: {}, shell: {}, fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
    runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), sendLog: () => undefined,
    getResourceRoot: () => root, getMainWindow: () => null, getStatus: async () => ({}),
    getSelectedFirmware: () => null, lines: (text) => String(text || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: () => path.join(root, 'output'), getActionHistoryPath: () => '', getCommandHistoryPath: () => '', getRendererLogPath: () => '',
    adb: async (args) => {
      calls.push(args);
      if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice\n', stderr: '' };
      return { code: 0, stdout: '2048:1700000000:/sdcard/DCIM/photo.jpg\n', stderr: '' };
    }
  });
  const result = await handlers['list-storage-files']({ serial: 'SERIAL', category: 'photos' });
  assert.equal(result.code, 0);
  assert.deepEqual(result.data.files, [{ bytes: 2048, modifiedAt: 1700000000, path: '/sdcard/DCIM/photo.jpg' }]);
  assert.ok(calls.some((args) => args.includes('find')));
  assert.ok(calls.every((args) => !args.includes('rm') && !args.includes('pull')));
});

test('V20.4.0 UI contract exposes task, app-management, storage, and log workflows', () => {
  for (const id of ['taskCenterDialog', 'appManagerList', 'appManagerSearch', 'appManagerSort', 'selectAllVisibleApps', 'storageManagerView', 'logSearch', 'copyLog', 'exportLog']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const category of ['apps', 'photos', 'videos', 'cache', 'junk']) {
    assert.match(html, new RegExp(`data-storage-category="${category}"`));
  }
  for (const category of ['photos', 'videos', 'downloads', 'documents']) {
    assert.match(html, new RegExp(`data-storage-file-category="${category}"`));
  }
  for (const id of ['storageFileSummary', 'storageFileSort', 'selectAllStorageFiles', 'selectedStorageFileCount', 'storageFileMessage', 'storageFileList']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(renderer, /function beginTask\(/);
  assert.match(renderer, /function finishTask\(/);
  assert.match(renderer, /function updateTaskProgress\(/);
  assert.match(renderer, /已有任务正在执行/);
  assert.match(renderer, /listScrollTop/);
  assert.match(renderer, /function loadStorageFiles\(/);
  assert.match(renderer, /function sortedStorageFiles\(/);
  assert.match(renderer, /selectedStorageFiles:\s*new Set\(\)/);
  assert.match(renderer, /storageFileSort = event\.target\.value/);
  assert.match(renderer, /function exportSelectedStorageFiles\(/);
  assert.match(renderer, /function previewSelectedStorageFileDelete\(/);
  assert.match(renderer, /未执行任何删除/);
  assert.match(renderer, /window\.gaoji\.run\('export-storage-files'/);
  const actions = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
  assert.match(actions, /handlers\['export-storage-files'\]/);
  assert.match(actions, /\['pull', file\.path, target\]/);
  assert.match(actions, /\[任务进度\]/);
  assert.doesNotMatch(actions, /handlers\['delete-storage-files'\]/);
  assert.match(renderer, /window\.gaoji\.run\('list-storage-files'/);
});
