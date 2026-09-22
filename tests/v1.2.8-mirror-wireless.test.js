const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createActionHandlers } = require('../src/action_handlers');

function createFakeResourceRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaoji-mirror-fix-'));
  const exeDir = path.join(root, 'scrcpy', 'scrcpy-win64-v4.0');
  fs.mkdirSync(exeDir, { recursive: true });
  fs.writeFileSync(path.join(exeDir, 'scrcpy.exe'), '');
  return root;
}

function createContext(spawnProcess, resourceRoot, adbImpl) {
  return {
    app: { getPath: () => 'C:\\Temp' }, dialog: {}, shell: {},
    adb: adbImpl || (async (args) => (args[0] === 'devices'
      ? { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n', stderr: '' }
      : { code: 0, stdout: '', stderr: '' })),
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
    runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), spawnProcess,
    sendLog: () => {}, getResourceRoot: () => resourceRoot,
    getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: (_dir, name) => name
  };
}

/** 造一个带 stdout/stderr 的假子进程，用于验证输出收集与参数。 */
function makeChild(pid, opts = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {};
  child.kill = () => { child.emit('exit', 0, null); return true; };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.emit('spawn');
    if (opts.exitAfterSpawn !== undefined) {
      setTimeout(() => child.emit('exit', opts.exitAfterSpawn, null), 10);
    }
  });
  return child;
}

// ---------------------------------------------------------------------------
// 投屏窗口必须真的能创建出来
//
// 用户实测反馈：提示"已启动"但屏幕上什么都没有。真机验证发现用
// detached:true + stdio:'ignore' 启动时，scrcpy 进程存活但
// MainWindowHandle=0、MainWindowTitle 为空 —— SDL 建不出窗口。
// 因此必须：非 detached、捕获输出。
// ---------------------------------------------------------------------------

test('回归：启动投屏不使用 detached，且捕获 stdout/stderr', async () => {
  const resourceRoot = createFakeResourceRoot();
  let captured = null;
  const spawnProcess = (exe, args, options) => {
    captured = { exe, args, options };
    return makeChild(5001);
  };
  const handlers = createActionHandlers(createContext(spawnProcess, resourceRoot));
  const started = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(started.code, 0);
  assert.equal(captured.options.detached, false, 'detached 必须为 false，否则 scrcpy 建不出窗口');
  assert.notEqual(captured.options.stdio, 'ignore', 'stdio 不能是 ignore，否则拿不到失败原因');
  assert.equal(captured.options.stdio[1], 'pipe');
  assert.equal(captured.options.stdio[2], 'pipe');
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('投屏启动后会带上 --serial 指定设备，避免多设备落到默认设备', async () => {
  const resourceRoot = createFakeResourceRoot();
  let captured = null;
  const spawnProcess = (exe, args, options) => { captured = { args }; return makeChild(5002); };
  const handlers = createActionHandlers(createContext(spawnProcess, resourceRoot));
  await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.ok(captured.args.includes('--serial'), '必须显式指定设备');
  assert.equal(captured.args[captured.args.indexOf('--serial') + 1], 'SERIAL');
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('scrcpy 启动后立即退出时报错并带上真实原因，不再谎报已启动', async () => {
  const resourceRoot = createFakeResourceRoot();
  const spawnProcess = () => {
    const child = makeChild(5003, { exitAfterSpawn: 1 });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('ERROR: Could not find any video encoder'));
    });
    return child;
  };
  const handlers = createActionHandlers(createContext(spawnProcess, resourceRoot));
  const result = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.notEqual(result.code, 0, '立即退出必须判为失败');
  assert.match(result.stderr, /立即退出/, '应说明启动后立即退出');
  assert.match(result.stderr, /video encoder/, '应带上 scrcpy 的真实报错');
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 无线连接
//
// 用户实测反馈：无线连不上。真机排查发现两点：
//   1. adb connect 连不上时退出码仍是 0，只在输出里写 failed —— 只看退出码
//      会把失败报成成功；
//   2. 用户不知道该填什么 IP。
// ---------------------------------------------------------------------------

test('无线连接：adb connect 输出 failed 时必须判为失败（退出码为 0）', async () => {
  const resourceRoot = createFakeResourceRoot();
  const adbImpl = async (args) => {
    if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n', stderr: '' };
    if (args[0] === 'tcpip') return { code: 0, stdout: 'restarting in TCP mode port: 5555', stderr: '' };
    if (args[0] === 'connect') return { code: 0, stdout: 'failed to connect to 192.168.1.12:5555', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const handlers = createActionHandlers(createContext(() => makeChild(1), resourceRoot, adbImpl));
  const result = await handlers['wireless-adb']({ serial: 'SERIAL', host: '192.168.1.12', port: '5555' });
  assert.notEqual(result.code, 0, 'connect 输出 failed 时必须判失败');
  assert.match(result.stderr, /无线调试连接失败/);
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('无线连接：成功时会校验设备真的出现在设备列表里', async () => {
  const resourceRoot = createFakeResourceRoot();
  const adbImpl = async (args) => {
    if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n192.168.1.12:5555\tdevice\n', stderr: '' };
    if (args[0] === 'tcpip') return { code: 0, stdout: 'restarting in TCP mode port: 5555', stderr: '' };
    if (args[0] === 'connect') return { code: 0, stdout: 'connected to 192.168.1.12:5555', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const handlers = createActionHandlers(createContext(() => makeChild(1), resourceRoot, adbImpl));
  const result = await handlers['wireless-adb']({ serial: 'SERIAL', host: '192.168.1.12', port: '5555' });
  assert.equal(result.code, 0, '设备确实在线时应判成功');
  assert.match(result.stdout, /无线调试已连接/);
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('无线连接：连接成功但设备未上线时仍然报失败', async () => {
  const resourceRoot = createFakeResourceRoot();
  const adbImpl = async (args) => {
    if (args[0] === 'tcpip') return { code: 0, stdout: 'restarting in TCP mode port: 5555', stderr: '' };
    if (args[0] === 'connect') return { code: 0, stdout: 'connected to 192.168.9.9:5555', stderr: '' };
    if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const handlers = createActionHandlers(createContext(() => makeChild(1), resourceRoot, adbImpl));
  const result = await handlers['wireless-adb']({ serial: 'SERIAL', host: '192.168.9.9', port: '5555' });
  assert.notEqual(result.code, 0, '设备没上线就不能报成功');
  assert.match(result.stderr, /未出现在设备列表/);
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});

test('无线投屏使用适配无线链路的参数，避免默认画质卡顿', async () => {
  const resourceRoot = createFakeResourceRoot();
  let capturedArgs = null;
  const spawnProcess = (exe, args) => { capturedArgs = args; return makeChild(5004); };
  const adbImpl = async (args) => {
    if (args[0] === 'tcpip') return { code: 0, stdout: 'restarting in TCP mode port: 5555', stderr: '' };
    if (args[0] === 'connect') return { code: 0, stdout: 'connected to 192.168.1.12:5555', stderr: '' };
    if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n192.168.1.12:5555\tdevice\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const handlers = createActionHandlers(createContext(spawnProcess, resourceRoot, adbImpl));
  const result = await handlers['wireless-mirror']({ serial: 'SERIAL', host: '192.168.1.12', port: '5555' });
  assert.equal(result.code, 0);
  assert.ok(capturedArgs.join(' ').includes('--video-bit-rate=8M'), '无线默认码率应下调');
  assert.ok(capturedArgs.join(' ').includes('--max-fps=30'), '无线默认帧率应封顶');
  fs.rmSync(resourceRoot, { recursive: true, force: true });
});
