const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createActionHandlers, shellArg } = require('./action_handlers');
const { createDeviceRebooter } = require('./device_reboot');
const { DANGEROUS_ACTIONS: DANGEROUS_ACTION_LIST } = require('./actions.registry');
const slotResolver = require('./slot_resolver');
const teaMatcher = require('./tea_matcher');
const teaBuilder = require('./tea_builder');
const bootImage = require('./boot_image');
const { resolveFlashTarget } = slotResolver;
const flashRunner = require('./flash_runner');
const { findFirmwareXml, parseFirmwareXml, firmwareReport } = require('./firmware_parser');
const { lines, parseAdbDevices, parseFastbootDevices } = require('./adb_parser');

// This managed Windows environment crashes Electron's GPU sandbox before the renderer opens.
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

let mainWindow;
const APP_VERSION = `V${app.getVersion()}`;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let selectedFirmware = null;
let activeActionTask = null;
const DANGEROUS_ACTIONS = new Set(DANGEROUS_ACTION_LIST);

function getResourceRoot() {
  if (app.isPackaged) {
    const nested = path.join(process.resourcesPath, 'resources', 'resources');
    if (fs.existsSync(nested)) return nested;
    return path.join(process.resourcesPath, 'resources');
  }
  return path.join(__dirname, '..', 'resources');
}

function getToolPath(name) {
  return path.join(getResourceRoot(), 'platform-tools', name);
}

// 历史文件按大小滚动，避免 jsonl 无限增长（此前 command-history 已累积到数 MB）。
const JSONL_MAX_BYTES = 2 * 1024 * 1024;
const JSONL_KEEP_FILES = 3;

function rotateJsonLine(target) {
  let size = 0;
  try {
    size = fs.statSync(target).size;
  } catch {
    return;
  }
  if (size < JSONL_MAX_BYTES) return;
  try {
    // 依次后移：x.jsonl.(n-1) -> x.jsonl.n，最旧的一份丢弃。
    for (let index = JSONL_KEEP_FILES - 1; index >= 1; index -= 1) {
      const from = `${target}.${index}`;
      const to = `${target}.${index + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(target, `${target}.1`);
  } catch {
    // 滚动失败不应影响主流程，继续追加即可。
  }
}

function appendJsonLine(filename, entry) {
  if (!app.isReady()) return;
  const target = path.join(app.getPath('userData'), filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  rotateJsonLine(target);
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
}

function safeCommandArgs(args) {
  return args.map((arg, index) => {
    const previous = String(args[index - 1] || '').toLowerCase();
    return previous === 'unlock' ? '[REDACTED]' : String(arg);
  });
}

function runProcess(file, args = [], options = {}) {
  return new Promise((resolve) => {
    const cwd = options.cwd || path.dirname(file);
    const child = spawn(file, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout = null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      appendJsonLine('command-history.jsonl', {
        time: new Date().toISOString(),
        executable: path.basename(file),
        args: safeCommandArgs(args),
        cwd,
        code
      });
      resolve({ code, stdout, stderr });
    };

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        stderr += `命令执行超过 ${options.timeoutMs}ms，已终止。`;
        child.kill();
        finish(124);
      }, options.timeoutMs);
    }

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (options.log) options.log(text);
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (options.log) options.log(text);
    });
    child.on('error', (error) => {
      stderr += error.message;
      finish(9009);
    });
    child.on('close', (code, signal) => {
      // code 为 null 表示进程被信号终止，而不是"正常退出且退出码为 0"。
      // 此前写成 `code ?? 0`，会把被杀死（例如刷机中途 USB 断开导致
      // fastboot 被终止）误判为成功——用户看到"刷机完成"，实际只刷了一半。
      if (code === null) {
        stderr += `\n进程被终止${signal ? `（信号 ${signal}）` : ''}，未能正常结束。`;
        finish(9009);
        return;
      }
      finish(code);
    });
  });
}

async function adb(args = [], options = {}) {
  return runProcess(getToolPath('adb.exe'), args, options);
}

async function fastboot(args = [], options = {}) {
  return runProcess(getToolPath('fastboot.exe'), args, options);
}

/**
 * 等待目标设备重新出现在 fastboot 列表里。
 *
 * `fastboot reboot-bootloader` 之后设备会重启回 fastboot，中间有十几秒
 * 完全不可用。不等它回来就发下一条命令，必然得到 `Device not found` ——
 * 这是"固件刷机有时中途失败"最常见的原因之一。
 *
 * @returns {boolean} 是否在超时前等到设备
 */
async function waitForFastbootDevice(serial, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  // 先等一小会儿：命令刚发出时设备还没开始重启，
  // 立刻查询会读到"设备仍在"的旧状态，等于没等。
  await new Promise((resolve) => setTimeout(resolve, 3000));
  while (Date.now() < deadline) {
    const result = await fastboot(['devices'], { timeoutMs: 15000 });
    const found = lines(result.stdout).some((line) => line.split(/\s+/)[0] === serial);
    if (found) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function getAdbValue(command) {
  const result = await adb(['shell', command]);
  if (result.code !== 0) return '';
  return lines(result.stdout || result.stderr)[0] || '';
}

async function getRootState() {
  const result = await adb(['shell', 'su', '-c', shellArg('id')], { timeoutMs: 4000 });
  const text = `${result.stdout}${result.stderr}`.trim();
  return { ok: result.code === 0 && /uid=0/.test(text), text };
}

async function getMagiskState(adbReady) {
  if (!adbReady) return { state: '未知', detail: '需要进入系统并完成 USB 调试授权' };
  const packages = await adb(['shell', 'pm', 'list', 'packages'], { timeoutMs: 8000 });
  const packageHits = lines(packages.stdout).filter((line) => /magisk|topjohnwu|kitsune/i.test(line));
  const cli = await adb(['shell', 'su', '-c', shellArg('magisk -v')], { timeoutMs: 4000 });
  const cliText = `${cli.stdout}${cli.stderr}`.trim();
  if (cli.code === 0 && cliText) {
    return { state: '已检测到', detail: `命令可用：${cliText}${packageHits.length ? `；应用：${packageHits.join(', ')}` : ''}` };
  }
  if (packageHits.length) return { state: '疑似已安装', detail: `应用：${packageHits.join(', ')}` };
  return { state: '未检测到', detail: '可在 Root/面具页安装内置 alpha.apk' };
}

let statusInFlight = null;
const versionCache = { adb: '', fastboot: '' };

async function getStatus() {
  if (statusInFlight) return statusInFlight;
  statusInFlight = (async () => {
    const adbResult = await adb(['devices', '-l'], { timeoutMs: 8000 });
    const fastbootResult = await fastboot(['devices', '-l'], { timeoutMs: 8000 });
    const adbDevices = parseAdbDevices(adbResult.stdout);
    const fastbootDevices = parseFastbootDevices(fastbootResult.stdout);
    const adbReady = adbDevices.some((d) => d.state === 'device');
    const unauthorized = adbDevices.some((d) => d.state === 'unauthorized');
    const root = adbReady ? await getRootState() : { ok: false, text: '' };
    const magisk = await getMagiskState(adbReady);

    let mode = '未连接';
    let deviceText = '未检测到设备';
    if (fastbootDevices.length) {
      mode = 'Fastboot';
      deviceText = fastbootDevices.map((d) => `${d.serial} fastboot`).join('; ');
    } else if (adbReady) {
      mode = '系统模式';
      deviceText = adbDevices.filter((d) => d.state === 'device').map((d) => `${d.serial} ${d.detail}`).join('; ');
    } else if (unauthorized) {
      mode = '未授权';
      deviceText = adbDevices.map((d) => d.serial).join('; ');
    }

    const props = {};
    if (adbReady) {
      const keys = {
        manufacturer: 'ro.product.manufacturer',
        model: 'ro.product.model',
        device: 'ro.product.device',
        android: 'ro.build.version.release',
        cpu: 'ro.product.board',
        slot: 'ro.boot.slot_suffix'
      };
      const wanted = new Set(Object.values(keys));
      const propMap = {};
      const allProps = await adb(['shell', 'getprop'], { timeoutMs: 8000 });
      for (const line of lines(allProps.stdout)) {
        const propMatch = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]$/);
        if (propMatch && wanted.has(propMatch[1])) propMap[propMatch[1]] = propMatch[2];
      }
      for (const [key, prop] of Object.entries(keys)) props[key] = propMap[prop] || '';
      props.battery = await getAdbValue('dumpsys battery | grep level');
    } else if (fastbootDevices.length) {
      const slot = await fastboot(['getvar', 'current-slot'], { timeoutMs: 8000 });
      const text = `${slot.stdout}${slot.stderr}`;
      const match = text.match(/current-slot:\s*([ab])/i);
      props.slot = match ? match[1] : '';
    }

    if (!versionCache.adb) {
      const adbV = await adb(['version'], { timeoutMs: 8000 });
      versionCache.adb = adbV.stdout.trim();
    }
    if (!versionCache.fastboot) {
      const fastbootV = await fastboot(['--version'], { timeoutMs: 8000 });
      versionCache.fastboot = fastbootV.stdout.trim();
    }

    return {
      mode,
      deviceText,
      adbDevices,
      fastbootDevices,
      root,
      magisk,
      props,
      adbVersion: versionCache.adb,
      fastbootVersion: versionCache.fastboot
    };
  })();
  try {
    return await statusInFlight;
  } finally {
    statusInFlight = null;
  }
}

function sendLog(text) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log', text);
}

const deviceRebooter = createDeviceRebooter({ adb, fastboot, log: sendLog });

async function findPartition(part) {
  const script = `for d in /dev/block/by-name /dev/block/bootdevice/by-name /dev/block/platform/*/by-name; do if [ -e "$d/${part}" ]; then echo "$d/${part}"; exit 0; fi; done; exit 1`;
  const result = await adb(['shell', 'su', '-c', shellArg(script)], { timeoutMs: 10000 });
  if (result.code !== 0) return '';
  return lines(result.stdout)[0] || '';
}

function uniqueOutputPath(dir, filename) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${i}${ext}`);
    i += 1;
  }
  return candidate;
}

function firmwareWorkspace() {
  const dir = path.join(app.getPath('desktop'), 'ADB搞机助手-刷机包');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function selectedFirmwareXml(mode = 'auto') {
  if (!selectedFirmware) return '';
  if (selectedFirmware.explicitXml && selectedFirmware.xmlPath) return selectedFirmware.xmlPath;
  return findFirmwareXml(selectedFirmware.rootDir || selectedFirmware.folder, mode);
}

async function extractFirmwareZip(zipPath) {
  const base = path.basename(zipPath, path.extname(zipPath)).replace(/[<>:"/\\|?*]+/g, '_').trim() || 'firmware';
  const target = uniqueOutputPath(firmwareWorkspace(), base);
  fs.mkdirSync(target, { recursive: true });
  sendLog(`[固件包] 正在解压：${zipPath}\n`);
  const tarPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const result = await runProcess(tarPath, ['-xf', zipPath, '-C', target], { log: sendLog });
  if (result.code !== 0) throw new Error(`刷机包解压失败：${result.stderr || result.stdout}`);
  const xmlPath = findFirmwareXml(target);
  if (!xmlPath) throw new Error('ZIP 内未找到 servicefile.xml、flashfile.xml 或其它 XML 刷机脚本。');
  return { folder: path.dirname(xmlPath), rootDir: target, xmlPath, extracted: target, explicitXml: false };
}

async function extractPartition(part, outDir) {
  sendLog(`\n[提取] 正在查找 ${part} ...\n`);
  const partPath = await findPartition(part);
  if (!partPath) {
    sendLog(`[跳过] 未找到 ${part}\n`);
    return { ok: false, skipped: true, part };
  }
  const remoteDir = '/sdcard/adb_gaoji_extract';
  const remote = `${remoteDir}/${part}.img`;
  const local = uniqueOutputPath(outDir, `${part}.img`);
  await adb(['shell', `mkdir -p ${remoteDir}`]);
  sendLog(`[读取] ${partPath}\n`);
  const dd = await adb(['shell', 'su', '-c', shellArg(`dd if=${partPath} of=${remote} bs=4096`)], { log: sendLog, timeoutMs: 60000 });
  if (dd.code !== 0) return { ok: false, part, error: dd.stderr || dd.stdout };
  sendLog(`[复制] ${local}\n`);
  const pull = await adb(['pull', remote, local], { log: sendLog });
  await adb(['shell', 'rm', '-f', remote]);
  return { ok: pull.code === 0, part, local, error: pull.stderr || pull.stdout };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: `ADB搞机助手 ${APP_VERSION}`,
    icon: path.join(getResourceRoot(), 'icons', 'app.ico'),
    backgroundColor: '#f3f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  const rendererLogDir = app.getPath('logs');
  fs.mkdirSync(rendererLogDir, { recursive: true });
  const rendererLog = path.join(rendererLogDir, 'renderer.log');
  mainWindow.webContents.on('did-finish-load', () => {
    fs.appendFileSync(rendererLog, '[did-finish-load]\n');
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    fs.appendFileSync(rendererLog, `[did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}\n`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    fs.appendFileSync(rendererLog, `[console:${level}] ${sourceId}:${line} ${message}\n`);
  });
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(`ADB搞机助手 ${APP_VERSION}`);
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('status:get', getStatus);

ipcMain.handle('log:copy', (_event, text = '') => {
  clipboard.writeText(String(text));
  return { code: 0 };
});

ipcMain.handle('log:export', async (_event, text = '') => {
  const defaultPath = path.join(app.getPath('desktop'), 'ADB搞机助手输出', `运行日志-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  const selected = await dialog.showSaveDialog(mainWindow, {
    title: '导出运行日志',
    defaultPath,
    filters: [{ name: '文本文件', extensions: ['txt'] }]
  });
  if (selected.canceled || !selected.filePath) return { code: 1, canceled: true, stdout: '', stderr: '已取消' };
  fs.mkdirSync(path.dirname(selected.filePath), { recursive: true });
  fs.writeFileSync(selected.filePath, String(text), 'utf8');
  return { code: 0, stdout: `日志已导出：${selected.filePath}`, stderr: '', filePath: selected.filePath };
});

const restoredActionHandlers = createActionHandlers({
  app,
  dialog,
  shell,
  adb,
  fastboot,
  runProcess,
  sendLog,
  getResourceRoot,
  getMainWindow: () => mainWindow,
  getStatus,
  getSelectedFirmware: () => selectedFirmware,
  lines,
  uniqueOutputPath,
  getActionHistoryPath: () => path.join(app.getPath('userData'), 'action-history.jsonl'),
  getCommandHistoryPath: () => path.join(app.getPath('userData'), 'command-history.jsonl'),
  getRendererLogPath: () => path.join(app.getPath('logs'), 'renderer.log')
});

function recordActionEvent(taskId, action, status, payload = {}, result = null) {
  const safePayload = { ...payload };
  for (const key of ['unlockKey', 'unlockCode', 'token', 'password']) {
    if (key in safePayload) safePayload[key] = '[REDACTED]';
  }
  appendJsonLine('action-history.jsonl', {
    time: new Date().toISOString(),
    taskId,
    action,
    status,
    payload: safePayload,
    ...(result ? { code: result.code, message: String(result.stderr || result.stdout || '').slice(0, 500) } : {})
  });
}

async function dispatchAction(action, payload = {}) {
  sendLog(`\n> ${action}\n`);
  if (DANGEROUS_ACTIONS.has(action) && payload.riskConfirmed !== true) {
    return { code: 3, stdout: '', stderr: '危险操作尚未完成界面确认，已阻止执行。' };
  }
  if (action === 'adb-reboot-system') return deviceRebooter.run(action, payload);
  if (typeof restoredActionHandlers[action] === 'function') {
    return restoredActionHandlers[action](payload);
  }
  switch (action) {
    case 'adb-authorize':
      await adb(['kill-server']);
      return adb(['start-server']);
    case 'install-magisk': {
      const apk = path.join(getResourceRoot(), 'apk', 'alpha.apk');
      if (!fs.existsSync(apk)) return { code: 1, stdout: '', stderr: `内置 Alpha 面具不存在：${apk}` };
      return adb(['install', '-r', apk], { log: sendLog });
    }
    case 'install-apk': {
      const selected = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'APK', extensions: ['apk'] }], properties: ['openFile'] });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };
      return adb(['install', '-r', selected.filePaths[0]], { log: sendLog });
    }
    case 'push-file': {
      const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
      if (selected.canceled || !selected.filePaths.length) return { code: 1, stdout: '', stderr: '已取消' };
      const results = [];
      for (const file of selected.filePaths) {
        const result = await adb(['push', file, `/sdcard/${path.basename(file)}`], { log: sendLog });
        results.push({ file, result });
        if (result.code !== 0) {
          return { code: result.code, stdout: results.map((item) => `${item.file}: ${item.result.code === 0 ? '成功' : '失败'}`).join('\n'), stderr: result.stderr || result.stdout };
        }
      }
      return { code: 0, stdout: `已推送 ${results.length} 个文件到 /sdcard/。`, stderr: '' };
    }
    case 'reboot-system':
    case 'reboot-recovery':
    case 'reboot-fastboot':
    case 'fastboot-reboot':
      return deviceRebooter.run(action, payload);
    case 'current-slot':
      return fastboot(['getvar', 'current-slot'], { log: sendLog });
    case 'flash-slot-info': {
      // 刷 boot/init_boot 前的一次性体检：
      //   设备是否 A/B 机型、当前活动槽位是哪个、目标分区在设备上是否真的存在。
      //
      // 为什么要逐个探测分区存在性：不同机型的 boot 布局差异很大——
      //   老机型只有 boot / recovery；Android 13+ 把 ramdisk 挪到 init_boot；
      //   部分机型还有 vendor_boot。名字猜错时 fastboot 会直接报错，
      //   但那是刷写中途才失败，此时镜像已经传了一部分，体验很差。
      //   提前用 getvar partition-size:<name> 探一遍，能在选镜像之前就告诉用户哪个可用。
      if (!mainWindow) return { code: 1, stdout: '', stderr: '主窗口不可用。' };

      const slotVar = await fastboot(['getvar', 'current-slot'], { timeoutMs: 8000 });
      const currentSlot = slotResolver.parseCurrentSlot(`${slotVar.stdout}${slotVar.stderr}`);

      // current-slot 读不到通常意味着两种情况之一：
      //   a) 这台机器不是 A/B 分区（单槽机型，分区名不带后缀）
      //   b) 当前不在 Fastboot 模式
      const isAbDevice = Boolean(currentSlot);

      const candidates = isAbDevice
        ? ['boot_a', 'boot_b', 'init_boot_a', 'init_boot_b', 'vendor_boot_a', 'vendor_boot_b',
           'vbmeta_a', 'vbmeta_b', 'dtbo_a', 'dtbo_b', 'recovery_a', 'recovery_b', 'super']
        : ['boot', 'init_boot', 'vendor_boot', 'vbmeta', 'dtbo', 'recovery', 'super'];

      // 逐个探测分区是否真实存在。
      //
      // 判据必须是"有没有解析出 0x 大小"：不存在的分区**不会**报 FAILED，
      // 而是回一个空值（实测 XT2241-1：
      //   `partition-size:init_boot_a:  Finished. Total time: 0.001s`）。
      // 早先只查 FAILED 关键字，把不存在的 init_boot 当成了存在，
      // 于是把一个不存在的分区提供给用户去刷，必然失败。
      const available = [];
      const missing = [];
      for (const name of candidates) {
        const probe = await fastboot(['getvar', `partition-size:${name}`], { timeoutMs: 6000 });
        const parsed = slotResolver.parsePartitionSize(`${probe.stdout}${probe.stderr}`);
        if (parsed.exists) available.push(name); else missing.push(name);
      }

      // 根据**实际存在的分区**决定该刷哪个分区，而不是按 Android 版本猜
      const ramdisk = slotResolver.pickRamdiskPartition(available);

      const lines = [
        `设备分区布局：${isAbDevice ? 'A/B 双槽' : '单槽（或未进入 Fastboot）'}`,
        `当前活动槽位：${currentSlot ? currentSlot.toUpperCase() : '未能读取'}`,
        '',
        `可写分区（${available.length}）：${available.join('、') || '无'}`,
        `不存在的分区（${missing.length}）：${missing.join('、') || '无'}`,
        '',
        ramdisk.partition
          ? `建议刷入分区：${ramdisk.partition}（${ramdisk.source}）`
          : `未能判断该刷哪个分区：${ramdisk.source}`
      ];

      // 给前端一份结构化数据：既能灰掉不存在的槽位，
      // 也能让"刷入 Boot"按**设备实际存在的分区**定默认值，
      // 而不是按 Android 版本猜。
      return {
        code: 0,
        stdout: lines.join('\n'),
        stderr: '',
        slotInfo: {
          isAbDevice,
          currentSlot,
          available,
          missing,
          ramdiskPartition: ramdisk.partition,
          ramdiskSource: ramdisk.source
        }
      };
    }
    case 'firmware-open-url': {
      const url = String(payload.url || '');
      if (!/^https:\/\//i.test(url)) return { code: 1, stdout: '', stderr: '固件下载地址无效。' };
      await shell.openExternal(url);
      sendLog(`[刷机包下载] 已打开：${payload.name || '固件目录'}\n${url}\n`);
      return { code: 0, stdout: `已打开 ${payload.name || '固件'} 下载页。`, stderr: '' };
    }
    case 'firmware-select-package': {
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: '选择官方固件 ZIP 或 Fastboot XML',
        filters: [{ name: '固件刷机包', extensions: ['zip', 'xml'] }, { name: '所有文件', extensions: ['*'] }],
        properties: ['openFile']
      });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };
      const input = selected.filePaths[0];
      const prepared = input.toLowerCase().endsWith('.zip')
        ? await extractFirmwareZip(input)
        : { folder: path.dirname(input), rootDir: path.dirname(input), xmlPath: input, extracted: '', explicitXml: true };
      selectedFirmware = prepared;
      const parsed = parseFirmwareXml(prepared.xmlPath, false);
      const report = firmwareReport(parsed);
      sendLog(`[固件刷机] 已选择：${prepared.xmlPath}\n${report}\n`);
      return { code: 0, stdout: `已载入固件刷机包。\n${report}`, stderr: '', firmwarePath: prepared.xmlPath, preview: report };
    }
    case 'firmware-select-folder': {
      const selected = await dialog.showOpenDialog(mainWindow, { title: '选择已解压的官方固件目录', properties: ['openDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };
      const xmlPath = findFirmwareXml(selected.filePaths[0]);
      if (!xmlPath) return { code: 1, stdout: '', stderr: '目录内未找到 Fastboot XML 刷机脚本。' };
      selectedFirmware = { folder: path.dirname(xmlPath), rootDir: selected.filePaths[0], xmlPath, extracted: selected.filePaths[0], explicitXml: false };
      const parsed = parseFirmwareXml(xmlPath, false);
      const report = firmwareReport(parsed);
      sendLog(`[固件刷机] 已选择目录：${selected.filePaths[0]}\n${report}\n`);
      return { code: 0, stdout: `已载入解压目录。\n${report}`, stderr: '', firmwarePath: xmlPath, preview: report };
    }
    case 'firmware-preview': {
      if (!selectedFirmware?.xmlPath) return { code: 1, stdout: '', stderr: '请先选择 ZIP、XML 或已解压固件目录。' };
      const xmlPath = selectedFirmwareXml(payload.xmlMode || 'auto');
      if (!xmlPath) return { code: 1, stdout: '', stderr: `当前目录没有找到 ${payload.xmlMode || 'auto'} 对应的 XML 刷机脚本。` };
      const parsed = parseFirmwareXml(xmlPath, payload.allowErase === true);
      const report = firmwareReport(parsed);
      sendLog(`[固件刷机] 命令预览\n${report}\n`);
      return { code: 0, stdout: report, stderr: '', firmwarePath: xmlPath, preview: report };
    }
    case 'firmware-flash': {
      if (!selectedFirmware?.xmlPath) return { code: 1, stdout: '', stderr: '请先选择 ZIP、XML 或已解压固件目录。' };
      const xmlPath = selectedFirmwareXml(payload.xmlMode || 'auto');
      if (!xmlPath) return { code: 1, stdout: '', stderr: `当前目录没有找到 ${payload.xmlMode || 'auto'} 对应的 XML 刷机脚本。` };
      const parsed = parseFirmwareXml(xmlPath, payload.allowErase === true);
      const missing = parsed.commands.filter((command) => command.args[0] === 'flash' && !fs.existsSync(command.file));
      if (missing.length) return { code: 1, stdout: '', stderr: `缺少 ${missing.length} 个镜像文件，已阻止刷机。\n${missing.map((command) => command.file).join('\n')}` };
      const devices = await fastboot(['devices']);
      const deviceLines = lines(devices.stdout);
      if (!deviceLines.length) return { code: 2, stdout: '', stderr: '当前未检测到 Fastboot 设备，请先进入 Fastboot。' };
      const targetSerial = String(payload.serial || '').trim() || deviceLines[0].split(/\s+/)[0];
      const targetMatch = deviceLines.find((line) => line.split(/\s+/)[0] === targetSerial);
      if (!targetMatch) return { code: 2, stdout: '', stderr: `未在 Fastboot 设备列表中找到目标设备 ${targetSerial}，请刷新后重试。` };

      const total = parsed.commands.length;
      const startedAt = Date.now();

      // 刷机过程需要同时送到两个地方：
      //   1) 底部日志面板（sendLog）—— 与其它操作统一，便于复制导出
      //   2) 刷机页面的进度区（flash-progress）—— 刷机时用户盯着的就是这个页面
      // 后者用结构化事件而不是让前端解析字符串，避免日志格式一改前端就失联。
      const sendFlashProgress = (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('flash-progress', payload);
        }
      };
      // fastboot 的输出是碎片化的（还带 \r 进度回显），逐条发事件会打爆 IPC，
      // 这里累积 150ms 合并发一次。
      let flashBuffer = '';
      let flashTimer = null;
      const flushFlashOutput = () => {
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
        if (!flashBuffer) return;
        sendFlashProgress({ phase: 'output', text: flashBuffer });
        flashBuffer = '';
      };
      const flashLog = (text) => {
        sendLog(text);
        flashBuffer += text;
        if (!flashTimer) flashTimer = setTimeout(flushFlashOutput, 150);
      };

      sendFlashProgress({ phase: 'start', total, serial: targetSerial, xmlPath: parsed.xmlPath });
      flashLog(`\n[固件刷机] 目标设备：${targetSerial}\n`);
      flashLog(`[固件刷机] 脚本：${parsed.xmlPath}\n`);
      flashLog(`[固件刷机] 共 ${total} 条命令${parsed.skipped.length ? `（另有 ${parsed.skipped.length} 条 erase 未执行：未勾选允许清除数据）` : ''}\n`);

      const failed = [];
      let succeeded = 0;
      let stoppedAt = 0;
      let leftFastboot = false;

      for (let index = 0; index < total; index += 1) {
        const command = parsed.commands[index];
        const label = flashRunner.describeCommand(command.args);
        const step = flashRunner.progressLine(index, total, command.args);
        sendFlashProgress({ phase: 'step', index, total, label });
        flashLog(`\n${step}\n`);

        // 设备已离开 fastboot（前面的 reboot 生效），后续命令必然失败，
        // 明确跳过并说明，而不是发一堆 Device not found 让用户困惑。
        if (leftFastboot) {
          flashLog('      设备已重启离开 Fastboot，跳过该命令。\n');
          continue;
        }

        // 镜像体积决定超时：super.img 这类几 GB 的分区需要更长时间
        let fileSizeBytes = 0;
        if (command.file) {
          try { fileSizeBytes = fs.statSync(command.file).size; } catch (error) { fileSizeBytes = 0; }
        }
        const timeoutMs = flashRunner.computeTimeout(command.args, { fileSizeBytes });

        // 传输层抖动（USB 接触不良、线材差）导致的失败重试一次；
        // 分区名错、镜像缺失这类重试无用，直接判定失败。
        const maxAttempts = 2;
        let attempt = 0;
        let outcome = null;
        let result = null;
        while (attempt < maxAttempts) {
          attempt += 1;
          const stepStart = Date.now();
          result = await fastboot(['-s', targetSerial, ...command.args], { log: flashLog, timeoutMs });
          const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
          outcome = flashRunner.analyzeResult(command.args, result);

          if (outcome.ok) {
            flashLog(`[刷机 ${index + 1}/${total}] 完成（${elapsed}s）\n`);
            break;
          }
          if (outcome.retryable && attempt < maxAttempts) {
            flashLog(`[刷机 ${index + 1}/${total}] ${outcome.reason}\n`);
            flashLog(`      传输中断，3 秒后重试（第 ${attempt + 1} 次尝试）\n`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          flashLog(`[刷机 ${index + 1}/${total}] 失败（${elapsed}s）：${outcome.reason}\n`);
          break;
        }

        if (!outcome.ok) {
          failed.push({ index: index + 1, label, reason: outcome.reason });
          sendFlashProgress({ phase: 'step-failed', index, total, label, reason: outcome.reason });
          if (outcome.fatal) {
            stoppedAt = index + 1;
            flashLog(`\n[固件刷机] 已在第 ${index + 1} 步停止，未继续执行后续命令。\n`);
            flashLog('      继续执行可能造成分区与启动槽不一致，因此在此中止。\n');
            break;
          }
          // getvar / reboot 类失败不阻断：只记下来继续
          flashLog('      该命令不影响刷机结果，继续执行。\n');
          continue;
        }

        succeeded += 1;

        // reboot-bootloader 之后设备要十几秒才回到 fastboot，
        // 必须等它回来再发下一条，否则后续全部 Device not found。
        if (flashRunner.needsDeviceWait(command.args)) {
          flashLog('      等待设备重新进入 Fastboot…\n');
          sendFlashProgress({ phase: 'waiting', index, total });
          const back = await waitForFastbootDevice(targetSerial, 90000);
          if (!back) {
            failed.push({ index: index + 1, label: '等待设备重连', reason: '设备未在 90 秒内重新出现在 Fastboot 列表' });
            stoppedAt = index + 1;
            flashLog('      设备未在 90 秒内回到 Fastboot，已停止。请检查数据线后重试。\n');
            break;
          }
          flashLog('      设备已回到 Fastboot。\n');
        }
        if (flashRunner.leavesFastboot(command.args)) leftFastboot = true;
      }

      const durationMs = Date.now() - startedAt;
      const durationText = `${(durationMs / 1000).toFixed(1)}s`;
      const summary = [
        `共 ${total} 条命令`,
        `成功 ${succeeded} 条`,
        failed.length ? `失败 ${failed.length} 条` : '失败 0 条',
        parsed.skipped.length ? `跳过 ${parsed.skipped.length} 条 erase` : '',
        `用时 ${durationText}`
      ].filter(Boolean).join('，');

      flashLog(`\n[固件刷机] ${stoppedAt ? `已中止：${summary}` : `全部执行完成：${summary}`}\n`);
      if (failed.length) {
        for (const item of failed) flashLog(`      · 第 ${item.index} 步 ${item.label}：${item.reason}\n`);
      }

      // 刷机成功后自动重启进入系统。
      //
      // 多数固件包的 XML 结尾并没有 reboot / continue 操作，刷完设备就
      // 一直停在 Fastboot 不动，用户会以为"刷完不开机"。这里在全部命令
      // 成功且设备仍在 Fastboot 时主动发一次 reboot。
      //
      // 只在真正成功时才重启：失败或中途停止的机器不应被自动拉起，
      // 留在 Fastboot 反而便于排查和重刷。设备已离开 Fastboot
      // （XML 自带 reboot/continue 生效）时也不再重复发送。
      let autoRebooted = false;
      if (!failed.length && !stoppedAt && !leftFastboot) {
        flashLog('\n[固件刷机] 正在重启进入系统…\n');
        sendFlashProgress({ phase: 'rebooting' });
        const rebootResult = await fastboot(['-s', targetSerial, 'reboot'], { log: flashLog, timeoutMs: 60000 });
        const rebootOutcome = flashRunner.analyzeResult(['reboot'], rebootResult);
        if (rebootOutcome.ok) {
          autoRebooted = true;
          flashLog('      已发送重启命令，手机将自动开机，请耐心等待。\n');
          flashLog('      首次开机可能需要几分钟，请勿拔线或断电。\n');
        } else {
          // 重启失败不影响刷机结论：镜像已经写完，用户可以手动开机。
          flashLog(`      自动重启失败：${rebootOutcome.reason}\n`);
          flashLog('      请长按电源键手动开机，或重新进入 Fastboot 后执行重启。\n');
        }
      } else if (!failed.length && !stoppedAt && leftFastboot) {
        flashLog('[固件刷机] 固件脚本已包含重启命令，设备正在开机。\n');
      }
      if (!failed.length && !stoppedAt) {
        flashLog('[固件刷机] 开机后请核对版本号与基带。\n');
      }

      const flashSummary = {
        total,
        succeeded,
        failed: failed.length,
        skippedErase: parsed.skipped.length,
        stoppedAt,
        durationMs,
        failures: failed,
        autoRebooted
      };

      // 收尾前把缓冲里的输出冲出去，否则界面上最后几行会缺失
      flushFlashOutput();
      sendFlashProgress({ phase: 'done', summary: flashSummary, ok: !failed.length && !stoppedAt });

      if (failed.length || stoppedAt) {
        return {
          code: 1,
          stdout: `固件刷机未完成：${summary}`,
          stderr: failed.map((item) => `第 ${item.index} 步 ${item.label}：${item.reason}`).join('\n'),
          flashSummary
        };
      }
      return {
        code: 0,
        stdout: `固件刷机完成：${summary}${autoRebooted ? '，已自动重启开机' : ''}`,
        stderr: '',
        flashSummary
      };
    }
    case 'firmware-open-folder': {
      if (!selectedFirmware) return { code: 1, stdout: '', stderr: '请先选择刷机包。' };
      const folder = selectedFirmware.rootDir || selectedFirmware.folder;
      const error = await shell.openPath(folder);
      return error ? { code: 1, stdout: '', stderr: `刷机包目录打开失败：${error}` } : { code: 0, stdout: `已打开刷机包目录：${folder}`, stderr: '' };
    }
    case 'firmware-motoflashpro': {
      const tool = 'C:\\Program Files (x86)\\MotoFlashPro\\MotoFlashPro.exe';
      if (!fs.existsSync(tool)) return { code: 1, stdout: '', stderr: '本机未找到 MotoFlashPro.exe。' };
      spawn(tool, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { code: 0, stdout: `已打开 MotoFlashPro：${tool}`, stderr: '' };
    }
    case 'show-flash':
      return { code: 0, stdout: '已切换到固件刷机页面。', stderr: '', navigate: 'firmware' };
    case 'open-matched-firmware': {
      const url = 'https://mirrors.lolinet.com/firmware/';
      await shell.openExternal(url);
      return { code: 0, stdout: `已打开匹配固件下载目录：${url}`, stderr: '' };
    }
    case 'check-root':
      return adb(['shell', 'su', '-c', shellArg('id')], { log: sendLog, timeoutMs: 4000 });
    case 'check-magisk':
      return adb(['shell', 'su', '-c', shellArg('magisk -v')], { log: sendLog, timeoutMs: 4000 });
    case 'extract-all': {
      const desktop = app.getPath('desktop');
      const bootDir = path.join(desktop, 'boot');
      const initDir = path.join(desktop, 'init_boot');
      const results = [];
      for (const part of ['boot_a', 'boot_b']) results.push(await extractPartition(part, bootDir));
      for (const part of ['init_boot_a', 'init_boot_b']) results.push(await extractPartition(part, initDir));
      return { code: results.some((r) => r.ok) ? 0 : 1, stdout: JSON.stringify(results, null, 2), stderr: '' };
    }
    case 'extract-part': {
      const desktop = app.getPath('desktop');
      const out = payload.part.startsWith('init_boot') ? path.join(desktop, 'init_boot') : path.join(desktop, 'boot');
      const result = await extractPartition(payload.part, out);
      return { code: result.ok ? 0 : 1, stdout: JSON.stringify(result, null, 2), stderr: result.error || '' };
    }
    case 'boot-image': {
      const selected = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'Images', extensions: ['img'] }], properties: ['openFile'] });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };
      return fastboot(['boot', selected.filePaths[0]], { log: sendLog });
    }
    // 「刷入 Boot」与「刷入其他分区」共用同一套执行逻辑：
    // 区别只在界面上暴露哪些分区选项，写入路径与校验完全一致。
    case 'flash-image':
    case 'flash-image-advanced': {
      // 目标分区名由 slot_resolver 统一拼装，规则与界面侧完全一致。
      //
      // 三种入参形态都支持：
      //   1) partition='boot' + slot='a'|'b'  -> boot_a / boot_b
      //   2) partition='boot_a'（已带后缀）     -> 原样使用
      //   3) slot='' 或单槽机型                 -> 保持裸分区名
      //
      // 拼完之后先跑一遍设备侧校验（分区是否存在、是否写向非活动槽），
      // 把问题拦在弹文件选择框之前——用户还没选镜像就被拦下，
      // 比传输到一半才失败要好得多。
      const deviceProbe = await fastboot(['getvar', 'current-slot'], { timeoutMs: 8000 });
      const probeText = `${deviceProbe.stdout}${deviceProbe.stderr}`;
      const probeMatch = probeText.match(/current-slot:\s*([ab])/i);
      const deviceSlot = probeMatch ? probeMatch[1].toLowerCase() : '';
      const isAbDevice = Boolean(deviceSlot);

      const target = resolveFlashTarget({
        partition: payload.partition || 'boot',
        slot: payload.slot,
        device: { isAbDevice, currentSlot: deviceSlot }
      });
      if (target.blocked) return { code: 2, stdout: '', stderr: target.blocked };

      const selected = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'Images', extensions: ['img'] }], properties: ['openFile'] });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };

      sendLog(`[刷入] 目标分区：${target.partition}\n${target.notes.join('\n')}\n`);
      const result = await fastboot(['flash', target.partition, selected.filePaths[0]], { log: sendLog });
      return {
        ...result,
        stdout: `${result.stdout || ''}\n目标分区：${target.partition}${target.notes.length ? `\n${target.notes.join('\n')}` : ''}`.trim(),
        stderr: result.stderr || ''
      };
    }
    /**
     * Tea 制作。
     *
     * 两种入口，都**不需要用户做技术选择**：
     *   · 默认（用户提供原厂 boot）：拿用户自己的 boot 当外壳，
     *     自动从内置模板里取 Tea 核心注入，产出可刷镜像；
     *   · 未提供 boot：退化为直接输出内置模板镜像（旧行为）。
     *
     * 前者才是"用我的原厂 boot 做"的正确做法：保留用户的
     * kernel / header / 签名块，只注入 Tea 运行时要用的文件。
     */
    case 'tea-boot-builder': {
      const library = path.join(getResourceRoot(), 'tea-templates');
      const manifestPath = path.join(library, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return { code: 1, stdout: '', stderr: `Tea 模板清单不存在：${manifestPath}` };
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const templates = manifest.templates.filter((item) => Array.isArray(item.files) && item.files.length);
      if (!templates.length) return { code: 1, stdout: '', stderr: 'Tea 模板库为空。' };

      // 以前这里弹两个框让用户选模板和槽位。用户不可能知道该选哪个——
      // 设备代号、机型、Android 版本、活动槽位都是程序能读到的，
      // 让用户猜等于把选错的风险转嫁给他。现在全部自动判定。
      const status = await getStatus();
      const matched = teaMatcher.matchTeaTemplate(manifest, status);
      if (!matched.ok) return { code: 2, stdout: '', stderr: `未能自动匹配 Tea 模板，已阻止输出。\n\n${matched.reason}` };
      const template = matched.template;
      if (template.reference_only) return { code: 2, stdout: '', stderr: `${template.model} 模板标记为 reference_only，只能用于结构参考，已阻止生成可刷镜像。\n${template.notes}` };

      const slotPick = teaMatcher.pickTeaSlotFile(template, status);
      if (!slotPick) return { code: 1, stdout: '', stderr: '匹配到的模板没有可用的镜像文件。' };
      sendLog(`[Tea 制作] ${matched.reason}，槽位 ${slotPick.slot}（自动判定，无需选择）\n`);
      const relative = slotPick.relative;
      const source = path.join(library, relative);

      // ── 自动制作：用用户提供的原厂 boot 作为外壳 ──────────────────────
      // 没带 stockBoot 时，直接弹选择框让用户挑一张原厂 boot——
      // 这样界面上只需要点一次按钮，不需要用户先理解"模板/供体"是什么。
      let stockBoot = String(payload.stockBoot || '').trim();
      if (!stockBoot && payload.pickStock !== false) {
        const picked = await dialog.showOpenDialog(mainWindow, {
          title: '选择你的原厂 boot 镜像（boot.img / init_boot.img）',
          filters: [{ name: 'Boot 镜像', extensions: ['img'] }],
          properties: ['openFile']
        });
        if (picked.canceled || !picked.filePaths.length) return { code: 1, stdout: '', stderr: '已取消。' };
        stockBoot = picked.filePaths[0];
        sendLog(`[Tea 制作] 已选原厂 boot：${stockBoot}\n`);
      }
      if (stockBoot) {
        const stockPath = stockBoot;
        if (!fs.existsSync(stockPath)) return { code: 1, stdout: '', stderr: `原厂 boot 不存在：${stockPath}` };
        if (!fs.existsSync(source)) return { code: 1, stdout: '', stderr: `Tea 供体镜像不存在：${source}` };

        const donorBuf = fs.readFileSync(source);
        const stockBuf = fs.readFileSync(stockPath);
        let built;
        try {
          built = teaBuilder.build(stockBuf, donorBuf);
        } catch (error) {
          return { code: 2, stdout: '', stderr: `Tea 自动制作失败，未生成任何镜像。\n\n${error.message}` };
        }

        const workspace = path.join(app.getPath('desktop'), 'Tea制作');
        const baseName = `boot_${template.code || 'tea'}_android${template.android}_Tea_自动制作.img`;
        const staged = uniqueOutputPath(workspace, baseName);
        fs.writeFileSync(staged, built.buffer);

        const outSha = crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex').toUpperCase();
        // 产物必须能被自己的解析器读回来，否则说明写出去的就是坏的。
        const recheck = bootImage.parse(fs.readFileSync(staged));
        const report = [
          `来源：用户提供的原厂 boot`,
          `原厂镜像：${stockPath}`,
          `Tea 供体：${template.id}（${template.model} / Android ${template.android}）`,
          `输出：${staged}`,
          `SHA256：${outSha}`,
          `内核：保留原厂（${recheck.kernelSize} 字节，未被改动）`,
          `签名块：保留原厂（${recheck.signatureSize} 字节）`,
          '',
          '制作步骤：',
          ...built.report.map((line) => `  · ${line}`)
        ].join('\n');
        fs.writeFileSync(`${staged}.txt`, report, 'utf8');
        sendLog(`[Tea 制作] 已自动完成：${staged}\n${report}\n`);
        await shell.openPath(workspace);
        return {
          code: 0,
          stdout: `Tea 镜像已用你的原厂 boot 自动制作完成。\n刷入前请核对：机型、Android 版本、分区、槽位。\n\n${report}`,
          stderr: ''
        };
      }
      if (!fs.existsSync(source)) return { code: 1, stdout: '', stderr: `模板镜像不存在：${source}` };
      const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').toUpperCase();
      if (template.sha256 && sourceSha256 !== String(template.sha256).toUpperCase()) {
        return { code: 1, stdout: '', stderr: `Tea 模板校验失败，已阻止输出。\n期望：${template.sha256}\n实际：${sourceSha256}` };
      }
      const workspace = path.join(app.getPath('desktop'), 'Tea制作');
      const staged = uniqueOutputPath(workspace, path.basename(source));
      fs.copyFileSync(source, staged);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex').toUpperCase();
      if (sha256 !== sourceSha256) return { code: 1, stdout: '', stderr: 'Tea 模板复制后校验不一致，已阻止继续。' };
      const report = [
        `模板库版本：${manifest.version}`,
        `模板：${template.id}`,
        `机型：${template.model}`,
        `设备代号：${template.code}`,
        `Android：${template.android}`,
        `分区：${template.partition || 'boot'}`,
        `槽位：${slotPick.slot}`,
        `输出：${staged}`,
        `SHA256：${sha256}`,
        `实机验证：${template.real_device_verified ? '是' : '未标记'}`,
        `说明：${template.notes}`
      ].join('\n');
      fs.writeFileSync(`${staged}.txt`, report, 'utf8');
      sendLog(`[Tea 制作] 已生成：${staged}\n${report}\n`);
      await shell.openPath(workspace);
      return {
        code: 0,
        stdout: `Tea 模板镜像已生成。刷入前必须再次核对机型、Android 版本、分区和槽位。\n\n${report}`,
        stderr: ''
      };
    }
    case 'install-driver': {
      const installer = path.join(getResourceRoot(), 'drivers', '一键安装安卓驱动.exe');
      if (!fs.existsSync(installer)) return { code: 1, stdout: '', stderr: `驱动安装包不存在：${installer}` };
      const error = await shell.openPath(installer);
      return error ? { code: 1, stdout: '', stderr: `驱动安装包打开失败：${error}` } : { code: 0, stdout: `已打开驱动安装包：${installer}`, stderr: '' };
    }
    case 'open-output': {
      const folder = path.join(app.getPath('desktop'), payload.dir || 'boot');
      fs.mkdirSync(folder, { recursive: true });
      const error = await shell.openPath(folder);
      return error ? { code: 1, stdout: '', stderr: `目录打开失败：${error}` } : { code: 0, stdout: `已打开目录：${folder}`, stderr: '' };
    }
    case 'open-terminal':
      spawn('cmd.exe', ['/k', `cd /d "${path.join(getResourceRoot(), 'platform-tools')}"`], { detached: true, stdio: 'ignore' }).unref();
      return { code: 0, stdout: '已打开命令行', stderr: '' };
    default:
      return { code: 1, stdout: '', stderr: `未知操作：${action}` };
  }
}

ipcMain.handle('action:run', async (_event, action, payload = {}) => {
  if (activeActionTask) {
    return { code: 409, stdout: '', stderr: `已有任务正在执行（${activeActionTask}），请等待当前任务完成。`, taskId: activeActionTask };
  }
  const taskId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  activeActionTask = taskId;
  recordActionEvent(taskId, action, 'running', payload);
  try {
    const result = await dispatchAction(action, payload);
    recordActionEvent(taskId, action, result.code === 0 ? 'completed' : 'failed', payload, result);
    return { ...result, taskId };
  } catch (error) {
    const result = { code: 1, stdout: '', stderr: `执行异常：${error.message}` };
    recordActionEvent(taskId, action, 'failed', payload, result);
    return { ...result, taskId };
  } finally {
    activeActionTask = null;
  }
});

// 全局异常落盘：此前只有渲染进程控制台日志，主进程崩溃不留痕迹。
function recordCrash(kind, error) {
  const detail = error && error.stack ? error.stack : String(error);
  try {
    if (app.isReady()) {
      const target = path.join(app.getPath('logs'), 'crash.log');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `[${new Date().toISOString()}] [${kind}] ${detail}\n`, 'utf8');
    }
  } catch {
    // 记录失败时静默处理，避免异常处理本身再次抛错。
  }
  try {
    sendLog(`\n[${kind}] ${detail}\n`);
  } catch {
    // 窗口可能已销毁。
  }
}

process.on('uncaughtException', (error) => {
  recordCrash('主进程未捕获异常', error);
});

process.on('unhandledRejection', (reason) => {
  recordCrash('主进程未处理的 Promise 拒绝', reason);
});
