const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createActionHandlers, shellArg } = require('./action_handlers');
const { createDeviceRebooter } = require('./device_reboot');
const { DANGEROUS_ACTIONS: DANGEROUS_ACTION_LIST } = require('./actions.registry');
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
    child.on('close', (code) => {
      finish(code ?? 0);
    });
  });
}

async function adb(args = [], options = {}) {
  return runProcess(getToolPath('adb.exe'), args, options);
}

async function fastboot(args = [], options = {}) {
  return runProcess(getToolPath('fastboot.exe'), args, options);
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
      const fastbootArgs = (command) => ['-s', targetSerial, ...command.args];
      sendLog(`\n[固件刷机] 目标设备：${targetSerial}\n[固件刷机] 开始执行 ${parsed.commands.length} 条 Fastboot 命令：${parsed.xmlPath}\n`);
      for (let index = 0; index < parsed.commands.length; index += 1) {
        const command = parsed.commands[index];
        sendLog(`[${index + 1}/${parsed.commands.length}] fastboot ${command.label}\n`);
        const result = await fastboot(fastbootArgs(command), { log: sendLog });
        if (result.code !== 0) {
          sendLog(`[固件刷机] 第 ${index + 1} 步失败，已停止后续命令。\n`);
          return { code: result.code, stdout: result.stdout, stderr: result.stderr || `第 ${index + 1} 步失败` };
        }
      }
      sendLog('[固件刷机] XML 命令已全部执行完成，请按需要重启到系统并复核版本。\n');
      return { code: 0, stdout: `已执行完成 ${parsed.commands.length} 条固件 Fastboot 命令。`, stderr: '' };
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
    case 'flash-image': {
      const selected = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'Images', extensions: ['img'] }], properties: ['openFile'] });
      if (selected.canceled || !selected.filePaths[0]) return { code: 1, stdout: '', stderr: '已取消' };
      return fastboot(['flash', payload.partition || 'boot', selected.filePaths[0]], { log: sendLog });
    }
    case 'tea-boot-builder': {
      const library = path.join(getResourceRoot(), 'tea-templates');
      const manifestPath = path.join(library, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return { code: 1, stdout: '', stderr: `Tea 模板清单不存在：${manifestPath}` };
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const templates = manifest.templates.filter((item) => Array.isArray(item.files) && item.files.length);
      if (!templates.length) return { code: 1, stdout: '', stderr: 'Tea 模板库为空。' };
      const selectedTemplate = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '选择 Tea 模板',
        message: '请选择与手机机型和 Android 版本匹配的 Tea 模板',
        detail: '模板不匹配可能导致无法启动。reference_only 模板只用于结构参考，不会允许输出为可刷镜像。',
        buttons: [...templates.map((item) => `Android ${item.android} · ${item.model}`), '取消'],
        cancelId: templates.length
      });
      if (selectedTemplate.response >= templates.length) return { code: 1, stdout: '', stderr: '已取消' };
      const template = templates[selectedTemplate.response];
      if (template.reference_only) return { code: 2, stdout: '', stderr: `${template.model} 模板标记为 reference_only，只能用于结构参考，已阻止生成可刷镜像。\n${template.notes}` };
      const slotChoice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '选择槽位',
        message: `目标模板：${template.model} / Android ${template.android}`,
        detail: `分区：${template.partition || 'boot'}。请选择要生成的槽位镜像。`,
        buttons: ['槽位 A', '槽位 B', '取消'],
        cancelId: 2
      });
      if (slotChoice.response === 2) return { code: 1, stdout: '', stderr: '已取消' };
      const relative = template.files[Math.min(slotChoice.response, template.files.length - 1)];
      const source = path.join(library, relative);
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
        `槽位：${slotChoice.response === 0 ? 'A' : 'B'}`,
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
