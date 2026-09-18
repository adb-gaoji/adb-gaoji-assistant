const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { auditActions } = require('../scripts/audit-actions');
const { createActionHandlers } = require('../src/action_handlers');

test('V20.5.0 backend action audit has complete registration and records remaining findings without opening UI', () => {
  const report = auditActions();
  assert.equal(report.version, 'V20.5.2');
  assert.equal(report.actions.missingHandlers.length, 0);
  assert.equal(report.actions.extraHandlers.length, 0);
  assert.equal(report.actions.unregisteredUiActions.length, 0);
  assert.ok(!report.findings.some((finding) => finding.id === 'device-action-without-selected-serial-guard'));
  assert.ok(!report.findings.some((finding) => finding.id === 'storage-export-basename-collision'));
  assert.ok(!report.findings.some((finding) => finding.id === 'storage-export-path-boundary-unverified'));
  assert.equal(report.status, 'pass');
});

test('V20.5.1 selected-device actions pass the serial to every device command', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-gaoji-audit-'));
  const calls = [];
  const handlers = createActionHandlers({
    app: { getPath: () => output },
    dialog: {}, shell: { openPath: async () => '', openExternal: async () => undefined },
    adb: async (args) => {
      calls.push(args);
      return args[0] === 'devices'
        ? { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice\n', stderr: '' }
        : { code: 0, stdout: '', stderr: '' };
    },
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }), runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), sendLog: () => undefined,
    getResourceRoot: () => output, getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean), uniqueOutputPath: (dir, name) => path.join(dir, name),
    getActionHistoryPath: () => '', getCommandHistoryPath: () => '', getRendererLogPath: () => ''
  });
  try {
    for (const [action, payload] of [
      ['screenshot', { serial: 'SERIAL' }],
      ['change-dpi', { serial: 'SERIAL', dpi: 420 }],
      ['gms-fix-crash', { serial: 'SERIAL' }]
    ]) {
      const start = calls.length;
      const result = await handlers[action](payload);
      assert.equal(result.code, 0);
      const deviceCalls = calls.slice(start).filter((args) => args[0] !== 'devices');
      assert.ok(deviceCalls.length > 0);
      assert.ok(deviceCalls.every((args) => args[0] === '-s' && args[1] === 'SERIAL'), `${action} must target SERIAL`);
    }
    const start = calls.length;
    const invalid = await handlers.screenshot({ serial: 'invalid serial' });
    assert.equal(invalid.code, 2);
    assert.equal(calls.length, start);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('V20.5.2 storage export rejects traversal and preserves duplicate basenames', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-gaoji-storage-audit-'));
  const calls = [];
  const handlers = createActionHandlers({
    app: { getPath: () => output },
    dialog: {}, shell: { openPath: async () => '', openExternal: async () => undefined },
    adb: async (args) => {
      calls.push(args);
      return args[0] === 'devices'
        ? { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice\n', stderr: '' }
        : { code: 0, stdout: '', stderr: '' };
    },
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }), runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), sendLog: () => undefined,
    getResourceRoot: () => output, getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean), uniqueOutputPath: (dir, name) => {
      fs.mkdirSync(dir, { recursive: true });
      let candidate = path.join(dir, name); let index = 1;
      while (fs.existsSync(candidate)) candidate = path.join(dir, `${path.basename(name, path.extname(name))}_${index++}${path.extname(name)}`);
      fs.writeFileSync(candidate, 'fixture');
      return candidate;
    },
    getActionHistoryPath: () => '', getCommandHistoryPath: () => '', getRendererLogPath: () => ''
  });
  try {
    const result = await handlers['export-storage-files']({
      serial: 'SERIAL',
      files: [
        { path: '/sdcard/DCIM/a.jpg' },
        { path: '/sdcard/Other/a.jpg' },
        { path: '/sdcard/../private.txt' }
      ]
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.data.invalid, ['/sdcard/../private.txt']);
    const pulls = calls.filter((args) => args[0] === '-s' && args[2] === 'pull');
    assert.equal(pulls.length, 2);
    assert.notEqual(pulls[0][3], pulls[1][3]);
    assert.match(pulls[0][3], /DCIM/);
    assert.match(pulls[1][3], /Other/);
    const beforeInvalidOnly = calls.length;
    const invalidOnly = await handlers['export-storage-files']({ serial: 'SERIAL', files: [{ path: '/sdcard/../private.txt' }] });
    assert.equal(invalidOnly.code, 1);
    assert.deepEqual(invalidOnly.data.invalid, ['/sdcard/../private.txt']);
    assert.equal(calls.length, beforeInvalidOnly);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
