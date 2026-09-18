function lines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseAdbDevices(text) {
  return lines(text)
    .filter((line) => !line.startsWith('List of devices'))
    .map((line) => {
      const [serial = '', state = ''] = line.split(/\s+/, 3);
      return { serial, state };
    })
    .filter((device) => device.serial);
}

function parseFastbootDevices(text) {
  return lines(text)
    .map((line) => ({ serial: line.split(/\s+/, 1)[0] || '', state: 'fastboot' }))
    .filter((device) => device.serial);
}

function fail(stderr, code = 2) {
  return { code, stdout: '', stderr };
}

function createDeviceRebooter({ adb, fastboot, log }) {
  async function detectTarget(payload = {}) {
    const requestedSerial = String(payload.serial || '').trim();
    if (requestedSerial && /[\s\0]/.test(requestedSerial)) {
      return { error: fail('当前设备序列号格式无效，请刷新设备列表后重试。') };
    }

    const [adbResult, fastbootResult] = await Promise.all([
      adb(['devices', '-l'], { timeoutMs: 7000 }),
      fastboot(['devices', '-l'], { timeoutMs: 7000 })
    ]);
    const adbDevices = parseAdbDevices(adbResult.stdout);
    const fastbootDevices = parseFastbootDevices(fastbootResult.stdout);
    const adbReady = adbDevices.filter((device) => device.state === 'device');
    const unauthorized = adbDevices.filter((device) => device.state === 'unauthorized');

    if (requestedSerial) {
      const adbDevice = adbReady.find((device) => device.serial === requestedSerial);
      if (adbDevice) return { mode: 'adb', serial: adbDevice.serial };
      const fastbootDevice = fastbootDevices.find((device) => device.serial === requestedSerial);
      if (fastbootDevice) return { mode: 'fastboot', serial: fastbootDevice.serial };
      if (unauthorized.some((device) => device.serial === requestedSerial)) {
        return { error: fail('当前手机尚未授权 USB 调试，请在手机上点击允许后刷新。') };
      }
      return { error: fail(`设备 ${requestedSerial} 已离线或模式已变化，请刷新设备状态后重试。`) };
    }

    if (adbReady[0]) return { mode: 'adb', serial: adbReady[0].serial };
    if (fastbootDevices[0]) return { mode: 'fastboot', serial: fastbootDevices[0].serial };
    if (unauthorized.length) return { error: fail('手机已连接但未授权 USB 调试，请在手机上点击允许。') };
    return { error: fail('未检测到可重启的 ADB 或 Fastboot 设备，请检查数据线和驱动。') };
  }

  async function execute(tool, mode, serial, args, successMessage) {
    const command = ['-s', serial, ...args];
    if (log) log(`[重启] ${mode === 'adb' ? 'adb' : 'fastboot'} ${command.join(' ')}\n`);
    const result = await tool(command, { log, timeoutMs: 15000 });
    if (result.code !== 0) return result;
    return {
      ...result,
      stdout: result.stdout || `${successMessage}\n设备：${serial}`,
      transport: mode,
      serial
    };
  }

  async function run(action, payload = {}) {
    const target = await detectTarget(payload);
    if (target.error) return target.error;
    const { mode, serial } = target;

    if (action === 'fastboot-reboot' && mode !== 'fastboot') {
      return fail('当前设备处于系统模式，不能执行 Fastboot 重启。请点击“重启系统”，或先进入 Bootloader。');
    }

    if (action === 'reboot-system' || action === 'adb-reboot-system' || action === 'fastboot-reboot') {
      return mode === 'adb'
        ? execute(adb, mode, serial, ['reboot'], '已通过 ADB 发送重启系统命令。')
        : execute(fastboot, mode, serial, ['reboot'], '已通过 Fastboot 发送重启系统命令。');
    }
    if (action === 'reboot-recovery') {
      return mode === 'adb'
        ? execute(adb, mode, serial, ['reboot', 'recovery'], '已通过 ADB 发送进入 Recovery 命令。')
        : execute(fastboot, mode, serial, ['reboot', 'recovery'], '已通过 Fastboot 发送进入 Recovery 命令。');
    }
    if (action === 'reboot-fastboot') {
      return mode === 'adb'
        ? execute(adb, mode, serial, ['reboot', 'bootloader'], '已通过 ADB 发送进入 Bootloader 命令。')
        : execute(fastboot, mode, serial, ['reboot', 'bootloader'], '已通过 Fastboot 发送重启 Bootloader 命令。');
    }
    return fail(`不支持的重启动作：${action}`, 1);
  }

  return { detectTarget, run };
}

module.exports = { createDeviceRebooter, parseAdbDevices, parseFastbootDevices };
