const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createActionHandlers } = require('../src/action_handlers');
const { auditMirrorSession } = require('../scripts/audit-mirror-session');

/**
 * 造一个只含 scrcpy.exe 的临时资源目录。
 *
 * 为什么不能直接用仓库里的 resources/：scrcpy 二进制体积大，不纳入版本控制
 * （见 .gitignore），CI 上克隆后并不存在，直接依赖真实目录会让「会话状态跟踪」
 * 这个纯粹的单元测试变成对环境是否装好 scrcpy 的隐式断言。
 * 这里用临时目录模拟出「scrcpy 已就位」这一前提，让测试只考察被测逻辑。
 */
function createFakeResourceRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaoji-mirror-'));
  const exeDir = path.join(root, 'scrcpy', 'scrcpy-win64-v4.0');
  fs.mkdirSync(exeDir, { recursive: true });
  fs.writeFileSync(path.join(exeDir, 'scrcpy.exe'), '');
  return root;
}

function createContext(spawnProcess, resourceRoot) {
  return {
    app: { getPath: () => 'C:\\Temp' }, dialog: {}, shell: {},
    adb: async (args) => args[0] === 'devices'
      ? { code: 0, stdout: 'List of devices attached\nSERIAL device product:test\n', stderr: '' }
      : { code: 0, stdout: '', stderr: '' },
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
    runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), spawnProcess,
    sendLog: () => {}, getResourceRoot: () => resourceRoot,
    getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: (_dir, name) => name
  };
}

test('mirror session tracks running state, rejects duplicates and can stop', async () => {
  const resourceRoot = createFakeResourceRoot();
  let child;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.pid = 4321;
    child.unref = () => {};
    child.kill = () => { child.emit('exit', 0, null); return true; };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const handlers = createActionHandlers(createContext(spawnProcess, resourceRoot));
  const started = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(started.code, 0);
  assert.equal(started.data.session.state, 'running');
  assert.equal(started.data.session.pid, 4321);

  const duplicate = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(duplicate.code, 409);

  const stopped = await handlers['stop-mirror']({ serial: 'SERIAL' });
  assert.equal(stopped.code, 0);
  assert.equal(stopped.data.session.state, 'exited');

  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('mirror session reports a clear error when scrcpy is missing', async () => {
  // 反向用例：资源目录里没有 scrcpy 时必须给出可读的缺失提示，
  // 而不是抛异常或静默返回成功。
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gaoji-empty-'));
  const handlers = createActionHandlers(createContext(() => new EventEmitter(), emptyRoot));
  const result = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /缺少 scrcpy/);
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

test('V20.5.8 mirror session audit passes without launching scrcpy', () => {
  const report = auditMirrorSession();
  assert.equal(report.version, 'V20.5.8');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
});

