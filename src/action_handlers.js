const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createAppPackageQuery } = require('./app_package_query');

const ACTION_IDS = [
  'adb-diagnose', 'adb-reboot-system', 'ai-copilot-scan', 'ai-export-report', 'ai-full-diagnose',
  'ai-smart-troubleshoot', 'ai-super-plan', 'backup-key-partitions', 'bootanim-backup',
  'bootanim-check-latest-portable', 'bootanim-compat-check', 'bootanim-extract-portable',
  'bootanim-image', 'bootanim-install-checked', 'bootanim-install-latest-portable', 'bootanim-install-zip',
  'bootanim-restore', 'bootanim-video', 'bootlogo-diagnose', 'change-dpi', 'change-size', 'check-zygisk', 'configure-denylist-user-apps',
  'clear-app-data', 'clear-storage-cache', 'clear-storage-junk', 'clear-storage-photos', 'clear-storage-videos',
  'clone-downloads', 'command-history', 'compare-device-snapshot', 'device-report',
  'diagnose-baseband', 'diagnose-wireless-stack', 'edl-9008-console', 'export-apk', 'export-apks-batch',
  'export-architecture-plan', 'export-log', 'extract-payload-bin', 'fastboot-continue',
  'fastboot-getvar-all', 'fastboot-set-active', 'fastboot-unlock-status', 'fix-adb-port',
  'fix-bluetooth-soft', 'fix-tiktok-network', 'fix-voice-call-audio', 'fix-wifi-after-flash',
  'flash-compatibility-gate', 'freeze-app-user0', 'freeze-apps-user0-batch', 'gms-deep-diagnose', 'gms-download-adapted',
  'gms-fix-app-license', 'gms-fix-crash', 'gms-import-local', 'gms-install-builtin',
  'gms-open-downloads', 'gms-open-google-switch', 'gms-persistent-fix', 'gms-uninstall',
  'install-aiwanji-toolbox', 'install-apk-batch', 'install-apk-single', 'install-bundled-adb-driver',
  'install-clone-tools', 'install-framework', 'install-lenovo-9008-driver', 'install-lenovo-deep-test',
  'install-users-manager', 'launch-package', 'lenovo-unlock-go', 'list-magisk-modules', 'list-packages', 'mirror-console', 'mirror-session-status',
  'moto-bl-unlock', 'open-key-backup-dir', 'open-lan-share', 'open-qpst-tools', 'open-tools-output', 'list-storage-files', 'export-storage-files',
  'preview-flash', 'pull-path', 'reboot-fastbootd', 'refresh-profile', 'rescue-diagnose',
  'reset-display', 'resume-flash', 'save-device-snapshot', 'screenrecord', 'screenshot', 'storage-summary',
  'start-freecontrol', 'start-mirror', 'start-mirror-hq', 'start-mirror-viewonly', 'stop-mirror', 'strategy-check',
  'task-queue-open', 'tea-clone-runtime-fix', 'unfreeze-app-user0', 'unfreeze-apps-user0-batch',
  'uninstall-package', 'uninstall-packages-batch',
  'wireless-adb', 'wireless-mirror', 'wireless-pair'
];

/**
 * 把一条命令包成单引号字符串，供 `su -c` / `sh -c` 使用。
 *
 * 为什么必须包：adb 把 `shell` 之后的参数用空格直接拼接，**不会**补引号，
 * 因此 `su -c pm list packages` 到设备上会变成 `su -c pm list packages`，
 * 远程 shell 按空格与 `;` 重新切分，命令被截断或串味。
 *
 * 单引号内的单引号用 `'\''` 序列转义（结束-转义-重新开始）。
 */
function shellArg(command) {
  const value = command === null || command === undefined ? '' : String(command);
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseWirelessEndpoint(host, port = 5555) {
  const normalizedHost = String(host || '').trim();
  const octets = normalizedHost.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  const rawPort = String(port ?? '').trim();
  const normalizedPort = rawPort ? Number(rawPort) : 5555;
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) return null;
  return { host: normalizedHost, port: normalizedPort, serial: `${normalizedHost}:${normalizedPort}` };
}

function parseWirelessPairingRequest(payload = {}) {
  const pairing = parseWirelessEndpoint(payload.host, payload.pairPort);
  const pairingCode = String(payload.pairingCode || '').trim();
  if (!pairing || !/^\d{6}$/.test(pairingCode)) return null;
  const rawConnectPort = String(payload.connectPort ?? '').trim();
  const connection = rawConnectPort ? parseWirelessEndpoint(payload.host, rawConnectPort) : null;
  if (rawConnectPort && !connection) return null;
  return { host: pairing.host, pairing, connection, pairingCode };
}

function createActionHandlers(ctx) {
  const {
    app, dialog, shell, adb, fastboot, runProcess, sendLog, getResourceRoot, getMainWindow,
    getStatus, getSelectedFirmware, lines, uniqueOutputPath,
    getActionHistoryPath, getCommandHistoryPath, getRendererLogPath
  } = ctx;
  const spawnProcess = ctx.spawnProcess || require('child_process').spawn;
  const mirrorSessions = new Map();

  const outputRoot = () => {
    const dir = path.join(app.getPath('desktop'), 'ADB搞机助手输出');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const historyPath = () => getActionHistoryPath?.() || path.join(app.getPath('userData'), 'action-history.jsonl');
  const commandHistoryPath = () => getCommandHistoryPath?.() || path.join(app.getPath('userData'), 'command-history.jsonl');
  const ok = (stdout, extra = {}) => ({ code: 0, stdout: String(stdout || ''), stderr: '', ...extra });
  const fail = (stderr, code = 1) => ({ code, stdout: '', stderr: String(stderr || '操作失败') });
  const textOf = (result) => `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  const mirrorSessionSnapshot = (session) => ({
    serial: session.serial,
    pid: session.pid,
    label: session.label,
    state: session.state,
    startedAt: session.startedAt,
    endedAt: session.endedAt || '',
    exitCode: session.exitCode ?? null,
    signal: session.signal || ''
  });
  const cleanupResult = (label, result) => {
    const output = textOf(result);
    const deleted = output.match(/deleted=(\d+)/)?.[1];
    const data = { deletedCount: deleted === undefined ? null : Number(deleted), failed: result.code === 0 ? [] : [output || `${label}失败。`] };
    return result.code === 0 ? ok(`${label}完成。${output ? `\n${output}` : ''}`, { data }) : { ...result, data };
  };
  const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.dng']);
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.3gp', '.m4v']);
  const JUNK_EXTENSIONS = new Set(['.apk', '.apks', '.xapk', '.apkm', '.tmp', '.temp', '.log', '.bak']);
  const STORAGE_FILE_CATEGORIES = {
    photos: { label: '照片', roots: ['/sdcard/DCIM', '/sdcard/Pictures'], matches: (file) => !file.path.includes('/.thumbnails/') && PHOTO_EXTENSIONS.has(path.extname(file.path).toLowerCase()) },
    videos: { label: '视频', roots: ['/sdcard/DCIM', '/sdcard/Movies', '/sdcard/Pictures'], matches: (file) => VIDEO_EXTENSIONS.has(path.extname(file.path).toLowerCase()) },
    downloads: { label: '下载', roots: ['/sdcard/Download'], matches: () => true },
    documents: { label: '文档', roots: ['/sdcard/Documents'], matches: () => true }
  };
  const parseStorageFiles = (text) => String(text || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\d+):(\/.*)$/);
    return match ? [{ bytes: Number(match[1]), path: match[2] }] : [];
  });
  const normalizeStorageRemotePath = (value) => {
    const raw = String(value || '').trim().replace(/\\/g, '/');
    if (!raw || raw.includes('\0') || !/^\/sdcard\//.test(raw)) return '';
    const segments = raw.slice('/sdcard/'.length).split('/');
    if (!segments.length || segments.some((segment) => segment === '..')) return '';
    const normalized = `/sdcard/${segments.filter((segment) => segment && segment !== '.').join('/')}`;
    return normalized === '/sdcard/' ? '' : normalized;
  };
  const safeStorageSegment = (value) => {
    const sanitized = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || '_';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(sanitized) ? `_${sanitized}` : sanitized;
  };
  const storageExportTarget = (root, remotePath, fallbackName) => {
    const relativeSegments = remotePath.slice('/sdcard/'.length).split('/').filter(Boolean).map(safeStorageSegment);
    const relativeName = relativeSegments.length ? relativeSegments : [fallbackName];
    const candidate = path.resolve(root, ...relativeName);
    const rootPrefix = `${path.resolve(root)}${path.sep}`;
    if (!candidate.startsWith(rootPrefix)) return '';
    const parent = path.dirname(candidate);
    fs.mkdirSync(parent, { recursive: true });
    return uniqueOutputPath(parent, path.basename(candidate));
  };
  const findStorageFiles = async (payload, roots, predicate) => {
    const listed = await adbFor(payload, ['shell', 'find', ...roots, '-type', 'f', '-exec', 'stat', '-c', '%s:%n', '{}', '\\;'], { timeoutMs: 60000, log: sendLog });
    return parseStorageFiles(listed.stdout).filter(predicate);
  };
  const findStorageFileDetails = async (payload, roots, predicate) => {
    const listed = await adbFor(payload, ['shell', 'find', ...roots, '-type', 'f', '-exec', 'stat', '-c', '%s:%Y:%n', '{}', '\\;'], { timeoutMs: 60000, log: sendLog });
    const files = String(listed.stdout || '').split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^(\d+):(\d+):(\/.*)$/);
      return match ? [{ bytes: Number(match[1]), modifiedAt: Number(match[2]), path: match[3] }] : [];
    }).filter(predicate);
    return { files, partial: listed.code !== 0 };
  };
  const removeStorageFiles = async (payload, label, files) => {
    const succeeded = [];
    const failed = [];
    for (const file of files) {
      const removed = await adbFor(payload, ['shell', 'rm', '-f', '--', file.path], { timeoutMs: 15000, log: sendLog });
      if (removed.code === 0) succeeded.push(file);
      else failed.push(`${file.path}：${textOf(removed) || '删除失败'}`);
    }
    const releasedBytes = succeeded.reduce((sum, file) => sum + file.bytes, 0);
    const data = { deletedCount: succeeded.length, releasedBytes, failed };
    const stdout = `${label}完成：已删除 ${succeeded.length} 个文件，预计释放 ${releasedBytes} 字节。`;
    return failed.length ? { code: 1, stdout, stderr: failed.join('\n'), data } : ok(stdout, { data });
  };
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const serialName = (payload = {}) => /^[A-Za-z0-9._:-]+$/.test(String(payload.serial || '')) ? String(payload.serial) : '';
  const adbFor = (payload, args, options) => {
    const serial = serialName(payload);
    if (!serial) return Promise.resolve(fail('没有选择有效的 ADB 设备。', 2));
    return adb(['-s', serial, ...args], options);
  };
  const appPackageQuery = createAppPackageQuery({ adb, getResourceRoot, sendLog });

  async function requireAdb() {
    const result = await adb(['devices', '-l']);
    const devices = lines(result.stdout).filter((line) => !line.startsWith('List of devices'));
    if (devices.some((line) => /\sdevice(?:\s|$)/.test(line))) return null;
    if (devices.some((line) => /\sunauthorized(?:\s|$)/.test(line))) return fail('手机已连接但未授权 USB 调试，请在手机上点击允许。', 2);
    return fail('未检测到已授权的 ADB 设备，请连接手机并开启 USB 调试。', 2);
  }

  async function requireSelectedAdb(payload = {}) {
    const serial = serialName(payload);
    if (!serial) return fail('没有选择有效的 ADB 设备。', 2);
    const result = await adb(['devices', '-l']);
    const row = lines(result.stdout).find((line) => line.split(/\s+/, 1)[0] === serial);
    if (/\sdevice(?:\s|$)/.test(row || '')) return null;
    if (/\sunauthorized(?:\s|$)/.test(row || '')) return fail('手机已连接但未授权 USB 调试，请在手机上点击允许。', 2);
    return fail(`未检测到所选设备：${serial}`, 2);
  }

  async function requireFastboot() {
    const result = await fastboot(['devices', '-l']);
    if (lines(result.stdout).length) return null;
    return fail('未检测到 Fastboot 设备，请进入 Fastboot 并检查驱动。', 2);
  }

  async function chooseFiles(options = {}) {
    const selected = await dialog.showOpenDialog(getMainWindow(), {
      title: options.title || '选择文件',
      filters: options.filters || [{ name: '所有文件', extensions: ['*'] }],
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    });
    return selected.canceled ? [] : selected.filePaths;
  }

  async function chooseFolder(title = '选择文件夹') {
    const selected = await dialog.showOpenDialog(getMainWindow(), { title, properties: ['openDirectory'] });
    return selected.canceled ? '' : selected.filePaths[0] || '';
  }

  async function openChecked(target, label) {
    if (!fs.existsSync(target)) return fail(`${label}不存在：${target}`);
    const error = await shell.openPath(target);
    return error ? fail(`${label}打开失败：${error}`) : ok(`已打开${label}：${target}`);
  }

  function writeReport(name, content, extension = 'txt') {
    const target = uniqueOutputPath(outputRoot(), `${name}_${stamp()}.${extension}`);
    fs.writeFileSync(target, content, 'utf8');
    return target;
  }

  function readJsonLines(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }

  function hashFile(file) {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(file);
    hash.update(data);
    return hash.digest('hex').toUpperCase();
  }

  async function collectDeviceFacts() {
    const status = await getStatus();
    const facts = { generatedAt: new Date().toISOString(), status };
    if (status.mode === '系统模式') {
      const commands = {
        fingerprint: ['shell', 'getprop', 'ro.build.fingerprint'],
        sdk: ['shell', 'getprop', 'ro.build.version.sdk'],
        securityPatch: ['shell', 'getprop', 'ro.build.version.security_patch'],
        storage: ['shell', 'df', '-h', '/data'],
        battery: ['shell', 'dumpsys', 'battery'],
        users: ['shell', 'pm', 'list', 'users'],
        packages: ['shell', 'pm', 'list', 'packages', '-3']
      };
      for (const [name, args] of Object.entries(commands)) facts[name] = textOf(await adb(args));
    }
    if (status.mode === 'Fastboot') facts.fastboot = textOf(await fastboot(['getvar', 'all']));
    return facts;
  }

  function recommendations(facts) {
    const items = [];
    const status = facts.status || {};
    if (status.mode === '未连接') items.push('先完成驱动、数据线和设备模式检查。');
    if (status.mode === '未授权') items.push('在手机上允许 USB 调试授权。');
    if (status.mode === 'Fastboot') items.push('刷写前核对 product、current-slot、unlocked 和镜像来源。');
    if (status.mode === '系统模式' && !status.root?.ok) items.push('需要读取受保护分区时，先确认 Shell 已取得 Root 授权。');
    if (/100%/.test(facts.storage || '')) items.push('数据分区空间不足，安装或备份前先清理空间。');
    if (!items.length) items.push('基础连接正常；执行写入动作前仍需核对机型、系统版本、槽位和备份。');
    return items;
  }

  async function diagnosticReport(title, save = false) {
    const facts = await collectDeviceFacts();
    const report = [title, `时间：${new Date().toLocaleString('zh-CN')}`, '', JSON.stringify(facts, null, 2), '', '建议：', ...recommendations(facts).map((item) => `- ${item}`)].join('\n');
    if (!save) return ok(report);
    const target = writeReport(title.replace(/[^0-9A-Za-z\u4e00-\u9fa5]+/g, '_'), report);
    await shell.openPath(target);
    return ok(`报告已生成：${target}\n\n${report}`);
  }

  function packageName(payload) {
    const value = String(payload.packageName || '').trim();
    return /^[A-Za-z0-9._]+$/.test(value) ? value : '';
  }

  function packageNames(payload) {
    if (!Array.isArray(payload.packageNames)) return [];
    return [...new Set(payload.packageNames.map((value) => String(value || '').trim()).filter((value) => /^[A-Za-z0-9._]+$/.test(value)))].slice(0, 500);
  }

  async function extractArchive(archive, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    return runProcess('tar.exe', ['-xf', archive, '-C', outDir], { cwd: outDir, log: sendLog });
  }

  function walkFiles(root, extensions) {
    const found = [];
    if (!fs.existsSync(root)) return found;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) found.push(...walkFiles(full, extensions));
      else if (extensions.includes(path.extname(entry.name).toLowerCase())) found.push(full);
    }
    return found;
  }

  async function installAndroidFile(file) {
    if (path.extname(file).toLowerCase() === '.apk') return adb(['install', '-r', file], { log: sendLog });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-gaoji-splits-'));
    const extracted = await extractArchive(file, temp);
    if (extracted.code !== 0) return extracted;
    const apks = walkFiles(temp, ['.apk']);
    if (!apks.length) return fail(`分包中未找到 APK：${file}`);
    return adb(['install-multiple', '-r', ...apks], { log: sendLog });
  }

  async function installFiles(files, title) {
    const guard = await requireAdb();
    if (guard) return guard;
    if (!files.length) return fail('没有选择安装包。');
    const results = [];
    let failures = 0;
    for (const file of files) {
      sendLog(`[${title}] ${path.basename(file)}\n`);
      const result = await installAndroidFile(file);
      if (result.code !== 0) failures += 1;
      results.push(`${path.basename(file)}：${result.code === 0 ? '成功' : '失败'}\n${textOf(result)}`);
    }
    return { code: failures ? 1 : 0, stdout: results.join('\n\n'), stderr: failures ? `${failures} 个安装包失败。` : '' };
  }

  async function exportPackage(payload) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const pkg = packageName(payload);
    if (!pkg) return fail('请输入有效的 Android 包名。');
    const pathsResult = await adbFor(payload, ['shell', 'pm', 'path', pkg]);
    const remote = lines(pathsResult.stdout).filter((line) => line.startsWith('package:')).map((line) => line.slice(8));
    if (!remote.length) return fail(`没有找到应用：${pkg}`);
    const dir = path.join(outputRoot(), '导出APK', `${pkg}_${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const item of remote) {
      const pulled = await adbFor(payload, ['pull', item, path.join(dir, path.basename(item))], { log: sendLog });
      if (pulled.code !== 0) return pulled;
    }
    await shell.openPath(dir);
    return ok(`已导出 ${remote.length} 个 APK 到：${dir}`);
  }

  async function packageCommand(payload, args, label) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const pkg = packageName(payload);
    if (!pkg) return fail('请输入有效的 Android 包名。');
    const installed = await adbFor(payload, ['shell', 'pm', 'path', pkg]);
    if (!lines(installed.stdout).length) return fail(`主系统中未找到应用：${pkg}`);
    const result = await adbFor(payload, ['shell', ...args(pkg)], { log: sendLog });
    return result.code === 0 ? ok(`${label}完成：${pkg}\n${textOf(result)}`) : result;
  }

  async function exportPackages(payload) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const packages = packageNames(payload);
    if (!packages.length) return fail('没有选择有效的应用。');
    const dir = path.join(outputRoot(), '导出APK', `批量_${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    const succeeded = [];
    const failed = [];
    for (const [index, pkg] of packages.entries()) {
      sendLog(`[批量导出 ${index + 1}/${packages.length}] ${pkg}\n`);
      sendLog(`[任务进度] ${index + 1}/${packages.length} ${pkg}\n`);
      const pathsResult = await adbFor(payload, ['shell', 'pm', 'path', pkg]);
      const remote = lines(pathsResult.stdout).filter((line) => line.startsWith('package:')).map((line) => line.slice(8));
      if (!remote.length) {
        failed.push({ packageName: pkg, message: textOf(pathsResult) || '没有找到 APK 路径' });
        continue;
      }
      const packageDir = path.join(dir, pkg);
      fs.mkdirSync(packageDir, { recursive: true });
      let error = '';
      for (const item of remote) {
        const pulled = await adbFor(payload, ['pull', item, path.join(packageDir, path.basename(item))], { log: sendLog });
        if (pulled.code !== 0) { error = textOf(pulled) || 'APK 拉取失败'; break; }
      }
      if (error) failed.push({ packageName: pkg, message: error });
      else succeeded.push(pkg);
    }
    if (succeeded.length) await shell.openPath(dir);
    const stdout = `批量导出完成：成功 ${succeeded.length} 个，失败 ${failed.length} 个。${succeeded.length ? `\n保存目录：${dir}` : ''}`;
    return { code: failed.length ? 1 : 0, stdout, stderr: failed.map((item) => `${item.packageName}：${item.message}`).join('\n'), data: { succeeded, failed, outputDir: dir } };
  }

  async function packageBatchCommand(payload, args, label) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const packages = packageNames(payload);
    if (!packages.length) return fail('没有选择有效的应用。');
    const succeeded = [];
    const failed = [];
    for (const [index, pkg] of packages.entries()) {
      sendLog(`[${label} ${index + 1}/${packages.length}] ${pkg}\n`);
      sendLog(`[任务进度] ${index + 1}/${packages.length} ${pkg}\n`);
      const installed = await adbFor(payload, ['shell', 'pm', 'path', pkg]);
      if (!lines(installed.stdout).length) {
        failed.push({ packageName: pkg, message: textOf(installed) || '主系统中未找到应用' });
        continue;
      }
      const result = await adbFor(payload, ['shell', ...args(pkg)], { log: sendLog });
      if (result.code === 0) succeeded.push(pkg);
      else failed.push({ packageName: pkg, message: textOf(result) || `退出码 ${result.code}` });
    }
    const stdout = `${label}完成：成功 ${succeeded.length} 个，失败 ${failed.length} 个。`;
    return { code: failed.length ? 1 : 0, stdout, stderr: failed.map((item) => `${item.packageName}：${item.message}`).join('\n'), data: { succeeded, failed } };
  }

  async function scrcpy(args, label, serial = '') {
    const sessionKey = serial || 'default';
    const existing = mirrorSessions.get(sessionKey);
    if (existing && ['starting', 'running', 'stopping'].includes(existing.state)) return fail(`${label}已经在设备 ${serial || '默认设备'} 上运行。`, 409);
    const guard = await requireAdb();
    if (guard) return guard;
    const exe = path.join(getResourceRoot(), 'scrcpy', 'scrcpy-win64-v4.0', 'scrcpy.exe');
    if (!fs.existsSync(exe)) return fail(`缺少 scrcpy：${exe}`);
    let session;
    try {
      const launchArgs = serial ? ['--serial', serial, ...args] : args;
      const child = spawnProcess(exe, launchArgs, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
      session = { serial, pid: child.pid || 0, label, state: 'starting', startedAt: new Date().toISOString(), child };
      mirrorSessions.set(sessionKey, session);
      child.once('exit', (code, signal) => {
        session.state = 'exited';
        session.endedAt = new Date().toISOString();
        session.exitCode = Number.isInteger(code) ? code : null;
        session.signal = signal || '';
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      session.state = 'running';
      child.unref();
      return ok(`${label}已启动。`, { data: { session: mirrorSessionSnapshot(session) } });
    } catch (error) {
      if (session) {
        session.state = 'failed';
        session.endedAt = new Date().toISOString();
      }
      return fail(`${label}启动失败：${error.message}`);
    }
  }

  async function startSelectedMirror(payload, args, label) {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    return scrcpy(args, label, serialName(payload));
  }

  async function gmsPackages() {
    const folders = [path.join(getResourceRoot(), 'gms'), path.join(app.getPath('userData'), 'gms')];
    const files = folders.flatMap((folder) => walkFiles(folder, ['.apk', '.apks', '.apkm', '.xapk']));
    const rank = (file) => /framework|gsf/i.test(file) ? 0 : /service|gms/i.test(file) ? 1 : /store|vending/i.test(file) ? 2 : 3;
    return files.sort((a, b) => rank(a) - rank(b));
  }

  async function gmsDiagnose(payload, save = false) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const packages = [['服务框架', 'com.google.android.gsf'], ['Play 服务', 'com.google.android.gms'], ['Play 商店', 'com.android.vending']];
    const details = [];
    for (const [name, pkg] of packages) {
      const dump = await adbFor(payload, ['shell', 'dumpsys', 'package', pkg]);
      const text = textOf(dump);
      const versionName = text.match(/versionName=([^\s]+)/)?.[1] || '-';
      const versionCode = text.match(/versionCode=(\d+)/)?.[1] || '-';
      const enabled = await adbFor(payload, ['shell', 'pm', 'list', 'packages', '-e', pkg]);
      details.push(`${name} / ${pkg}\n安装：${text.includes('versionCode=') ? '是' : '否'}\n启用：${lines(enabled.stdout).length ? '是' : '否'}\n版本：${versionName} (${versionCode})`);
    }
    const props = [];
    for (const prop of ['ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abilist']) props.push(`${prop}=${textOf(await adbFor(payload, ['shell', 'getprop', prop]))}`);
    const report = `Google 服务诊断\n${props.join('\n')}\n\n${details.join('\n\n')}`;
    if (!save) return ok(report);
    const target = writeReport('Google服务诊断', report);
    await shell.openPath(target);
    return ok(`报告已导出：${target}\n\n${report}`);
  }

  async function gmsAllowlist(payload, packages) {
    const output = [];
    for (const pkg of packages) {
      const commands = [
        ['pm', 'enable', '--user', '0', pkg],
        ['cmd', 'package', 'install-existing', '--user', '0', pkg],
        ['cmd', 'deviceidle', 'whitelist', `+${pkg}`],
        ['cmd', 'appops', 'set', '--user', '0', pkg, 'RUN_IN_BACKGROUND', 'allow'],
        ['cmd', 'appops', 'set', '--user', '0', pkg, 'RUN_ANY_IN_BACKGROUND', 'allow']
      ];
      for (const args of commands) {
        const result = await adbFor(payload, ['shell', ...args]);
        output.push(`${pkg} | ${args.slice(0, 3).join(' ')} | ${result.code === 0 ? 'OK' : textOf(result)}`);
      }
    }
    return output;
  }

  async function wirelessReport(title) {
    const guard = await requireAdb();
    if (guard) return guard;
    const checks = [
      ['Wi-Fi', ['shell', 'cmd', 'wifi', 'status']],
      ['Wi-Fi 服务', ['shell', 'dumpsys', 'wifi']],
      ['蓝牙', ['shell', 'dumpsys', 'bluetooth_manager']],
      ['基带版本', ['shell', 'getprop', 'gsm.version.baseband']],
      ['SIM/信号', ['shell', 'dumpsys', 'telephony.registry']],
      ['无线日志', ['shell', 'logcat', '-d', '-t', '300']]
    ];
    const sections = [];
    for (const [name, args] of checks) {
      const result = await adb(args);
      let text = textOf(result);
      if (name.includes('日志')) text = lines(text).filter((line) => /wifi|wlan|bluetooth|radio|modem|fatal|error/i.test(line)).slice(-100).join('\n');
      sections.push(`【${name}】\n${text.slice(0, 12000) || '无输出'}`);
    }
    const report = `${title}\n时间：${new Date().toLocaleString('zh-CN')}\n\n${sections.join('\n\n')}`;
    const target = writeReport(title, report);
    return ok(`${report}\n\n报告：${target}`);
  }

  async function locateBootAnimation(payload) {
    const script = 'for f in /product/media/bootanimation.zip /system/product/media/bootanimation.zip /system/media/bootanimation.zip /vendor/media/bootanimation.zip; do [ -f "$f" ] && echo "$f" && exit 0; done; exit 1';
    const found = await adbFor(payload, ['shell', 'su', '-c', shellArg(script)], { timeoutMs: 10000 });
    return lines(found.stdout)[0] || '';
  }

  async function backupBootAnimation(payload, label = 'bootanimation') {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const remote = await locateBootAnimation(payload);
    if (!remote) return fail('未找到系统 bootanimation.zip，或 Shell 未取得 Root 权限。');
    const tempRemote = '/sdcard/adb_gaoji_bootanimation.zip';
    const copy = await adbFor(payload, ['shell', 'su', '-c', shellArg(`cp "${remote}" ${tempRemote} && chmod 644 ${tempRemote}`)], { timeoutMs: 15000 });
    if (copy.code !== 0) return copy;
    const dir = path.join(outputRoot(), '开机动画备份');
    const local = uniqueOutputPath(dir, `${label}.zip`);
    const pulled = await adbFor(payload, ['pull', tempRemote, local], { log: sendLog });
    await adbFor(payload, ['shell', 'rm', '-f', tempRemote]);
    if (pulled.code !== 0) return pulled;
    const manifest = `${local}\n来源：${remote}\nSHA256：${hashFile(local)}\n`;
    fs.writeFileSync(`${local}.txt`, manifest, 'utf8');
    await shell.openPath(dir);
    return ok(`开机动画已备份：${local}\n来源：${remote}\nSHA256：${hashFile(local)}`);
  }

  async function chooseBootZip(title) {
    const files = await chooseFiles({ title, filters: [{ name: 'bootanimation.zip', extensions: ['zip'] }] });
    return files[0] || '';
  }

  async function inspectBootZip(file) {
    const listed = await runProcess('tar.exe', ['-tf', file], { cwd: path.dirname(file) });
    if (listed.code !== 0) return { result: listed, valid: false, detail: textOf(listed) };
    const entries = lines(listed.stdout);
    const valid = entries.some((item) => /(^|\/)desc\.txt$/i.test(item)) && entries.some((item) => /part\d+\/.*\.(png|jpg|webp)$/i.test(item));
    return { result: listed, valid, detail: `文件：${file}\nSHA256：${hashFile(file)}\n条目：${entries.length}\n包含 desc.txt：${entries.some((item) => /(^|\/)desc\.txt$/i.test(item)) ? '是' : '否'}\n包含动画帧：${entries.some((item) => /part\d+\/.*\.(png|jpg|webp)$/i.test(item)) ? '是' : '否'}\n\n${entries.slice(0, 120).join('\n')}` };
  }

  async function installBootZip(payload, file) {
    const guard = await requireSelectedAdb(payload);
    if (guard) return guard;
    const inspected = await inspectBootZip(file);
    if (!inspected.valid) return fail(`动画包结构不完整，已阻止安装。\n${inspected.detail}`);
    const current = await locateBootAnimation(payload);
    if (!current) return fail('未找到可替换的系统开机动画路径，或没有 Root 权限。');
    const backup = await backupBootAnimation(payload, '安装前备份');
    if (backup.code !== 0) return fail(`安装前备份失败，已阻止写入。\n${textOf(backup)}`);
    const remote = '/sdcard/adb_gaoji_new_bootanimation.zip';
    const pushed = await adbFor(payload, ['push', file, remote], { log: sendLog });
    if (pushed.code !== 0) return pushed;
    const install = await adbFor(payload, ['shell', 'su', '-c', shellArg(`mount -o rw,remount /product 2>/dev/null || true; mount -o rw,remount /system 2>/dev/null || true; cp ${remote} "${current}" && chmod 644 "${current}"`)], { log: sendLog, timeoutMs: 30000 });
    await adbFor(payload, ['shell', 'rm', '-f', remote]);
    return install.code === 0 ? ok(`开机动画已安装到：${current}\n${inspected.detail}`) : install;
  }

  const handlers = {};

  handlers['adb-diagnose'] = async () => {
    const results = [];
    results.push(`kill-server\n${textOf(await adb(['kill-server']))}`);
    results.push(`start-server\n${textOf(await adb(['start-server']))}`);
    results.push(`devices -l\n${textOf(await adb(['devices', '-l']))}`);
    results.push(`adb version\n${textOf(await adb(['version']))}`);
    return ok(results.join('\n\n'));
  };
  handlers['adb-reboot-system'] = async (payload) => (await requireSelectedAdb(payload)) || adbFor(payload, ['reboot'], { log: sendLog });
  handlers['ai-copilot-scan'] = async () => diagnosticReport('智能协同扫描', false);
  handlers['ai-smart-troubleshoot'] = async () => diagnosticReport('智能故障分析', false);
  handlers['ai-full-diagnose'] = async () => diagnosticReport('完整设备诊断', true);
  handlers['ai-super-plan'] = async () => diagnosticReport('维修执行方案', true);
  handlers['ai-export-report'] = async () => diagnosticReport('综合修复报告', true);
  handlers['device-report'] = async () => diagnosticReport('设备信息报告', true);
  handlers['strategy-check'] = async () => diagnosticReport('维修策略报告', true);
  handlers['refresh-profile'] = async () => {
    const facts = await collectDeviceFacts();
    const target = path.join(app.getPath('userData'), 'device-profile.json');
    fs.writeFileSync(target, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
    return ok(`设备档案已刷新：${target}\n${JSON.stringify(facts.status, null, 2)}`);
  };
  handlers['save-device-snapshot'] = async () => {
    const facts = await collectDeviceFacts();
    const target = writeReport('设备快照', JSON.stringify(facts, null, 2), 'json');
    return ok(`设备快照已保存：${target}`);
  };
  handlers['compare-device-snapshot'] = async () => {
    const files = await chooseFiles({ title: '选择之前保存的设备快照', filters: [{ name: 'JSON 快照', extensions: ['json'] }] });
    if (!files[0]) return fail('已取消。');
    let previous;
    try { previous = JSON.parse(fs.readFileSync(files[0], 'utf8')); } catch (error) { return fail(`快照解析失败：${error.message}`); }
    const current = await collectDeviceFacts();
    const before = JSON.stringify(previous, null, 2).split('\n');
    const after = JSON.stringify(current, null, 2).split('\n');
    const changed = [...new Set([...before, ...after])].filter((line) => before.includes(line) !== after.includes(line));
    const report = `旧快照：${files[0]}\n\n变化行：\n${changed.join('\n') || '未发现文本差异'}\n\n当前快照：\n${JSON.stringify(current, null, 2)}`;
    const target = writeReport('设备快照对比', report);
    return ok(`对比报告：${target}\n\n${report}`);
  };
  handlers['export-architecture-plan'] = async () => {
    const content = ['ADB搞机助手执行架构', '1. 界面动作 -> preload IPC -> 主进程专用 handler', '2. 所有设备动作先检查 ADB/Fastboot 模式', '3. 文件写入动作先选择文件、校验存在性并二次确认', '4. 命令输出写入运行日志和动作历史', '5. 危险操作不自动绕过 Bootloader、Root 或系统确认'].join('\n');
    const target = writeReport('执行架构', content);
    return ok(`架构说明已导出：${target}`);
  };
  handlers['export-log'] = async () => {
    const actionLog = fs.existsSync(historyPath()) ? fs.readFileSync(historyPath(), 'utf8') : '暂无动作历史。';
    const commandLog = fs.existsSync(commandHistoryPath()) ? fs.readFileSync(commandHistoryPath(), 'utf8') : '暂无命令历史。';
    const rendererPath = getRendererLogPath?.();
    const rendererLog = rendererPath && fs.existsSync(rendererPath) ? fs.readFileSync(rendererPath, 'utf8') : '暂无界面日志。';
    const target = writeReport('完整运行日志', `=== 动作历史 ===\n${actionLog}\n\n=== 命令历史 ===\n${commandLog}\n\n=== 界面日志 ===\n${rendererLog}`);
    await shell.openPath(target);
    return ok(`完整运行日志已导出：${target}`);
  };
  handlers['command-history'] = async () => {
    const entries = readJsonLines(commandHistoryPath());
    const report = entries.length
      ? entries.slice(-500).map((entry) => `${entry.time || '-'}  ${entry.executable || '-'} ${(entry.args || []).join(' ')}  -> ${entry.code}`).join('\n')
      : '暂无命令历史。执行任意 ADB、Fastboot 或本地工具动作后会写入这里。';
    const target = writeReport('命令历史', report);
    await shell.openPath(target);
    return ok(`命令历史已打开，共 ${entries.length} 条：${target}`);
  };
  handlers['task-queue-open'] = async () => {
    const entries = readJsonLines(historyPath());
    const tasks = new Map();
    for (const entry of entries) {
      const key = entry.taskId || `${entry.time || ''}-${entry.action || ''}`;
      tasks.set(key, { ...(tasks.get(key) || {}), ...entry });
    }
    const recent = [...tasks.values()].slice(-200).reverse();
    const running = recent.filter((task) => task.status === 'running').length;
    const failed = recent.filter((task) => task.status === 'failed').length;
    const report = [
      `任务总数：${tasks.size}`,
      `当前执行：${running}`,
      `最近失败：${failed}`,
      '',
      ...recent.map((task) => `${task.time || '-'}  [${task.status || 'legacy'}]  ${task.action || '-'}  code=${task.code ?? '-'}`)
    ].join('\n');
    const target = writeReport('任务队列', report);
    await shell.openPath(target);
    return ok(`任务队列已打开：${target}`);
  };

  handlers['list-packages'] = async (payload) => {
    const guard = await requireSelectedAdb(payload);
    return guard || appPackageQuery.run(payload);
  };
  handlers['storage-summary'] = async (payload) => {
    const guard = await requireSelectedAdb(payload);
    return guard || appPackageQuery.storage(payload);
  };
  handlers['list-storage-files'] = async (payload) => {
    const category = STORAGE_FILE_CATEGORIES[payload.category];
    if (!category) return fail('请选择照片、视频、下载或文档分类。', 2);
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const result = await findStorageFileDetails(payload, category.roots, category.matches);
    return ok(`已读取 ${category.label}：${result.files.length} 个文件${result.partial ? '；部分目录不可访问，已跳过。' : '。'}`, {
      data: { category: payload.category, roots: category.roots, files: result.files, partial: result.partial }
    });
  };
  handlers['export-storage-files'] = async (payload) => {
    const invalid = [];
    const files = Array.isArray(payload.files) ? payload.files.flatMap((file) => {
      const normalizedPath = normalizeStorageRemotePath(file?.path);
      if (!file || !normalizedPath) {
        if (file?.path) invalid.push(String(file.path));
        return [];
      }
      return [{ ...file, path: normalizedPath }];
    }) : [];
    if (!files.length) {
      if (!invalid.length) return fail('没有选择可导出的手机文件。', 2);
      const data = { succeeded: [], failed: [], invalid, outputDir: '' };
      return { code: 1, stdout: `文件导出已阻止：${invalid.length} 个路径无效。`, stderr: invalid.map((filePath) => `${filePath}：路径不在 /sdcard 公共存储范围内或包含非法路径段。`).join('\n'), data };
    }
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const dir = path.join(outputRoot(), '文件导出', stamp());
    fs.mkdirSync(dir, { recursive: true });
    const succeeded = [];
    const failed = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const target = storageExportTarget(dir, file.path, `file-${index + 1}`);
      if (!target) {
        invalid.push(file.path);
        continue;
      }
      const result = await adbFor(payload, ['pull', file.path, target], { timeoutMs: 120000, log: sendLog });
      sendLog(`[任务进度] ${index + 1}/${files.length} ${file.path}\n`);
      if (result.code === 0) succeeded.push(file.path);
      else failed.push(`${file.path}：${textOf(result) || '导出失败'}`);
    }
    const data = { succeeded, failed, invalid, outputDir: dir };
    const stdout = `文件导出完成：成功 ${succeeded.length} 个，失败 ${failed.length} 个，无效路径 ${invalid.length} 个。\n输出目录：${dir}`;
    const errors = [...failed, ...invalid.map((filePath) => `${filePath}：路径不在 /sdcard 公共存储范围内或包含非法路径段。`)];
    return errors.length ? { code: 1, stdout, stderr: errors.join('\n'), data } : ok(stdout, { data });
  };
  handlers['launch-package'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const pkg = packageName(payload); if (!pkg) return fail('请输入有效的 Android 包名。');
    const result = await adbFor(payload, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { log: sendLog });
    return result.code === 0 ? ok(`应用已启动：${pkg}\n${textOf(result)}`) : result;
  };
  handlers['install-apk-single'] = async () => installFiles(await chooseFiles({ title: '选择 APK/APKS', filters: [{ name: 'Android 安装包', extensions: ['apk', 'apks', 'apkm', 'xapk'] }] }), '单个安装');
  handlers['install-apk-batch'] = async () => {
    const folder = await chooseFolder('选择包含 APK/APKS 的文件夹');
    return installFiles(folder ? walkFiles(folder, ['.apk', '.apks', '.apkm', '.xapk']) : [], '批量安装');
  };
  handlers['install-framework'] = async () => installFiles(await chooseFiles({ title: '选择框架安装包', filters: [{ name: '框架 APK/APKS', extensions: ['apk', 'apks'] }], multiple: true }), '框架安装');
  handlers['export-apk'] = exportPackage;
  handlers['export-apks-batch'] = exportPackages;
  handlers['uninstall-package'] = async (payload) => packageCommand(payload, (pkg) => ['pm', 'uninstall', '--user', '0', pkg], '主用户卸载');
  handlers['uninstall-packages-batch'] = async (payload) => packageBatchCommand(payload, (pkg) => ['pm', 'uninstall', '--user', '0', pkg], '批量卸载');
  handlers['clear-app-data'] = async (payload) => packageCommand(payload, (pkg) => ['pm', 'clear', '--user', '0', pkg], '应用数据清理');
  handlers['freeze-app-user0'] = async (payload) => packageCommand(payload, (pkg) => ['sh', '-c', shellArg(`pm suspend --user 0 ${pkg}; pm disable-user --user 0 ${pkg}`)], '应用冻结');
  handlers['freeze-apps-user0-batch'] = async (payload) => packageBatchCommand(payload, (pkg) => ['sh', '-c', shellArg(`pm suspend --user 0 ${pkg}; pm disable-user --user 0 ${pkg}`)], '批量冻结');
  handlers['unfreeze-app-user0'] = async (payload) => packageCommand(payload, (pkg) => ['sh', '-c', shellArg(`pm unsuspend --user 0 ${pkg}; pm enable --user 0 ${pkg}`)], '应用解冻');
  handlers['unfreeze-apps-user0-batch'] = async (payload) => packageBatchCommand(payload, (pkg) => ['sh', '-c', shellArg(`pm unsuspend --user 0 ${pkg}; pm enable --user 0 ${pkg}`)], '批量解冻');
  handlers['clear-storage-cache'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const result = await adbFor(payload, ['shell', 'pm', 'trim-caches', '999G'], { log: sendLog });
    return cleanupResult('应用缓存清理', result);
  };
  handlers['clear-storage-junk'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const files = await findStorageFiles(payload, ['/sdcard/Download', '/sdcard/Documents', '/sdcard/.Trash', '/sdcard/DCIM/.thumbnails'], (file) => file.path.includes('/.Trash/') || file.path.includes('/.thumbnails/') || JUNK_EXTENSIONS.has(path.extname(file.path).toLowerCase()));
    return removeStorageFiles(payload, '垃圾文件清理', files);
  };
  handlers['clear-storage-photos'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const files = await findStorageFiles(payload, ['/sdcard/DCIM', '/sdcard/Pictures'], (file) => !file.path.includes('/.thumbnails/') && PHOTO_EXTENSIONS.has(path.extname(file.path).toLowerCase()));
    return removeStorageFiles(payload, '照片清理', files);
  };
  handlers['clear-storage-videos'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const files = await findStorageFiles(payload, ['/sdcard/DCIM', '/sdcard/Movies', '/sdcard/Pictures'], (file) => VIDEO_EXTENSIONS.has(path.extname(file.path).toLowerCase()));
    return removeStorageFiles(payload, '视频清理', files);
  };

  handlers['gms-deep-diagnose'] = async (payload) => gmsDiagnose(payload, true);
  handlers['gms-install-builtin'] = async () => installFiles(await gmsPackages(), '谷歌三件套安装');
  handlers['gms-import-local'] = async () => {
    const files = await chooseFiles({ title: '导入谷歌三件套 APK/APKS', filters: [{ name: 'Android 安装包', extensions: ['apk', 'apks', 'apkm', 'xapk'] }], multiple: true });
    if (!files.length) return fail('已取消。');
    const dir = path.join(app.getPath('userData'), 'gms'); fs.mkdirSync(dir, { recursive: true });
    for (const file of files) fs.copyFileSync(file, path.join(dir, path.basename(file)));
    await shell.openPath(dir);
    return ok(`已导入 ${files.length} 个安装包：${dir}`);
  };
  handlers['gms-download-adapted'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const dir = path.join(outputRoot(), '谷歌三件套'); fs.mkdirSync(dir, { recursive: true });
    const files = await gmsPackages();
    for (const file of files) fs.copyFileSync(file, path.join(dir, path.basename(file)));
    const diagnosis = await gmsDiagnose(payload, false);
    fs.writeFileSync(path.join(dir, '设备适配说明.txt'), `${diagnosis.stdout}\n\n安装顺序：GSF -> Play 服务 -> Play 商店。`, 'utf8');
    await shell.openPath(dir);
    return ok(`已按当前设备信息准备 ${files.length} 个内置包：${dir}`);
  };
  handlers['gms-open-downloads'] = async () => {
    const urls = ['https://www.apkmirror.com/apk/google-inc/google-services-framework/', 'https://www.apkmirror.com/apk/google-inc/google-play-services/', 'https://www.apkmirror.com/apk/google-inc/google-play-store/'];
    for (const url of urls) await shell.openExternal(url);
    return ok(`已打开三个官方组件的 APKMirror 下载分类页。\n${urls.join('\n')}`);
  };
  handlers['gms-open-google-switch'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const candidates = [
      ['shell', 'am', 'start', '-n', 'com.motorola.cn.prcsettingsext/.Settings$GoogleSwitchActivity'],
      ['shell', 'am', 'start', '-a', 'android.settings.APPLICATION_DETAILS_SETTINGS', '-d', 'package:com.google.android.gsf'],
      ['shell', 'am', 'start', '-a', 'android.settings.SEARCH_SETTINGS', '--es', 'query', '谷歌服务']
    ];
    for (const args of candidates) { const result = await adbFor(payload, args); if (result.code === 0 && !/Error:/i.test(textOf(result))) return ok(`已在手机上打开谷歌服务设置。\n${textOf(result)}`); }
    return fail('手机系统没有可用的谷歌服务开关页面。');
  };
  handlers['gms-fix-crash'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const packages = ['com.google.android.gsf', 'com.google.android.gms', 'com.android.vending'];
    const details = await gmsAllowlist(payload, packages);
    for (const pkg of packages) details.push(`${pkg} clear：${textOf(await adbFor(payload, ['shell', 'pm', 'clear', '--user', '0', pkg]))}`);
    return ok(`谷歌服务已重新启用、放行并清理主用户数据。\n${details.join('\n')}`);
  };
  handlers['gms-persistent-fix'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const packages = ['com.google.android.gsf', 'com.google.android.gms', 'com.android.vending'];
    const details = await gmsAllowlist(payload, packages);
    const script = `#!/system/bin/sh\n${packages.map((pkg) => `pm enable --user 0 ${pkg}\ncmd deviceidle whitelist +${pkg}`).join('\n')}\n`;
    const local = path.join(os.tmpdir(), '99_adb_gaoji_gms.sh'); fs.writeFileSync(local, script, 'utf8');
    await adbFor(payload, ['push', local, '/data/local/tmp/99_adb_gaoji_gms.sh']);
    const root = await adbFor(payload, ['shell', 'su', '-c', shellArg('mkdir -p /data/adb/service.d && cp /data/local/tmp/99_adb_gaoji_gms.sh /data/adb/service.d/99_adb_gaoji_gms.sh && chmod 755 /data/adb/service.d/99_adb_gaoji_gms.sh')], { timeoutMs: 15000 });
    details.push(root.code === 0 ? '已安装 Magisk service.d 开机放行脚本。' : `当前无 Root 或 service.d 不可写，仅完成运行时放行：${textOf(root)}`);
    return ok(details.join('\n'));
  };
  handlers['gms-fix-app-license'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const target = packageName(payload); if (!target) return fail('请输入有效的目标应用包名。');
    const details = await gmsAllowlist(payload, ['com.google.android.gsf', 'com.google.android.gms', 'com.android.vending', target]);
    await adbFor(payload, ['shell', 'am', 'force-stop', target]);
    const launch = await adbFor(payload, ['shell', 'monkey', '-p', target, '-c', 'android.intent.category.LAUNCHER', '1']);
    return launch.code === 0 ? ok(`目标应用已放行并重新启动：${target}\n${details.join('\n')}`) : launch;
  };
  handlers['gms-uninstall'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const details = [];
    for (const pkg of ['com.android.vending', 'com.google.android.gms', 'com.google.android.gsf']) details.push(`${pkg}: ${textOf(await adbFor(payload, ['shell', 'pm', 'uninstall', '--user', '0', pkg]))}`);
    return ok(details.join('\n'));
  };

  handlers['pull-path'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const remote = String(payload.remotePath || '').trim(); if (!remote.startsWith('/')) return fail('请输入以 / 开头的完整手机路径。');
    const dir = path.join(outputRoot(), '拉取文件'); fs.mkdirSync(dir, { recursive: true });
    const result = await adbFor(payload, ['pull', remote, dir], { log: sendLog });
    if (result.code === 0) await shell.openPath(dir);
    return result;
  };
  handlers['screenshot'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const remote = '/sdcard/adb_gaoji_screenshot.png'; const target = uniqueOutputPath(outputRoot(), '手机截图.png');
    const shot = await adbFor(payload, ['shell', 'screencap', '-p', remote]); if (shot.code !== 0) return shot;
    const pull = await adbFor(payload, ['pull', remote, target], { log: sendLog }); await adbFor(payload, ['shell', 'rm', '-f', remote]);
    if (pull.code === 0) await shell.openPath(target);
    return pull.code === 0 ? ok(`截图已保存：${target}`) : pull;
  };
  handlers['screenrecord'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const duration = Math.max(1, Math.min(180, Number(payload.duration) || 15));
    const remote = '/sdcard/adb_gaoji_record.mp4'; const target = uniqueOutputPath(outputRoot(), '手机录屏.mp4');
    const record = await adbFor(payload, ['shell', 'screenrecord', '--time-limit', String(duration), remote], { log: sendLog }); if (record.code !== 0) return record;
    const pull = await adbFor(payload, ['pull', remote, target], { log: sendLog }); await adbFor(payload, ['shell', 'rm', '-f', remote]);
    if (pull.code === 0) await shell.openPath(target);
    return pull.code === 0 ? ok(`录屏已保存：${target}`) : pull;
  };
  handlers['change-dpi'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const dpi = Number(payload.dpi); if (!Number.isInteger(dpi) || dpi < 120 || dpi > 1000) return fail('DPI 必须是 120 到 1000 的整数。');
    return adbFor(payload, ['shell', 'wm', 'density', String(dpi)], { log: sendLog });
  };
  handlers['change-size'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const size = String(payload.size || ''); if (!/^\d{3,4}x\d{3,4}$/.test(size)) return fail('分辨率格式应为 1080x2400。');
    return adbFor(payload, ['shell', 'wm', 'size', size], { log: sendLog });
  };
  handlers['reset-display'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const density = await adbFor(payload, ['shell', 'wm', 'density', 'reset']); const size = await adbFor(payload, ['shell', 'wm', 'size', 'reset']);
    return density.code || size.code ? fail(`${textOf(density)}\n${textOf(size)}`) : ok('DPI 和分辨率已恢复系统默认值。');
  };
  handlers['open-tools-output'] = async () => openChecked(outputRoot(), '工具输出目录');
  handlers['open-key-backup-dir'] = async () => { const dir = path.join(outputRoot(), '关键分区备份'); fs.mkdirSync(dir, { recursive: true }); return openChecked(dir, '关键分区备份目录'); };

  handlers['start-mirror'] = async (payload) => startSelectedMirror(payload, [], '有线投屏');
  handlers['start-mirror-hq'] = async (payload) => startSelectedMirror(payload, ['--video-bit-rate=20M', '--max-fps=60'], '高画质投屏');
  handlers['start-mirror-viewonly'] = async (payload) => startSelectedMirror(payload, ['--no-control'], '仅显示投屏');
  handlers['mirror-console'] = async (payload) => {
    const bitrate = Math.max(1, Math.min(100, Number(payload.bitrate) || 12));
    const maxSize = Math.max(480, Math.min(4320, Number(payload.maxSize) || 1920));
    const fps = Math.max(15, Math.min(120, Number(payload.fps) || 60));
    const args = [`--video-bit-rate=${bitrate}M`, `--max-size=${maxSize}`, `--max-fps=${fps}`, '--pause-on-exit=if-error'];
    if (payload.control === 'view') args.push('--no-control');
    return startSelectedMirror(payload, args, `投屏控制台（${bitrate}M / ${maxSize}px / ${fps}fps）`);
  };
  handlers['mirror-session-status'] = async () => ok('已读取投屏会话状态。', { data: { sessions: [...mirrorSessions.values()].map(mirrorSessionSnapshot) } });
  handlers['stop-mirror'] = async (payload) => {
    const serial = serialName(payload);
    if (!serial) return fail('没有选择有效的投屏设备。', 2);
    const session = mirrorSessions.get(serial);
    if (!session || !['starting', 'running', 'stopping'].includes(session.state)) return fail(`设备 ${serial} 没有正在运行的投屏会话。`, 2);
    session.state = 'stopping';
    if (!session.child.kill()) {
      session.state = 'running';
      return fail(`设备 ${serial} 的投屏进程停止失败。`);
    }
    return ok(`设备 ${serial} 的投屏会话已停止。`, { data: { session: mirrorSessionSnapshot(session) } });
  };
  handlers['wireless-adb'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const endpoint = parseWirelessEndpoint(payload.host, payload.port);
    if (!endpoint) return fail('请输入有效的手机 IPv4 地址和端口。');
    const tcpip = await adbFor(payload, ['tcpip', String(endpoint.port)], { log: sendLog }); if (tcpip.code !== 0) return tcpip;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return adb(['connect', endpoint.serial], { log: sendLog });
  };
  handlers['wireless-pair'] = async (payload) => {
    const request = parseWirelessPairingRequest(payload);
    if (!request) return fail('请输入有效的手机 IPv4、配对端口和 6 位配对码。');
    const paired = await adb(['pair', request.pairing.serial, request.pairingCode], { timeoutMs: 30000, log: sendLog });
    if (paired.code !== 0) return paired;
    if (!request.connection) return ok(`无线调试配对成功：${request.pairing.serial}`, { data: { pairingSerial: request.pairing.serial, connectionSerial: '' } });
    const connected = await adb(['connect', request.connection.serial], { timeoutMs: 30000, log: sendLog });
    if (connected.code !== 0) return connected;
    return ok(`无线调试配对并连接成功：${request.connection.serial}`, { data: { pairingSerial: request.pairing.serial, connectionSerial: request.connection.serial } });
  };
  handlers['wireless-mirror'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const selectedSerial = serialName(payload);
    let mirrorSerial = selectedSerial;
    if (String(payload.host || '').trim()) {
      const endpoint = parseWirelessEndpoint(payload.host, payload.port);
      if (!endpoint) return fail('请输入有效的手机 IPv4 地址和端口。');
      const connected = await handlers['wireless-adb'](payload);
      if (connected.code !== 0) return connected;
      mirrorSerial = endpoint.serial;
    } else if (!/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(selectedSerial)) {
      return fail('无线投屏需要手机 IP 和端口，或已连接的无线 ADB 设备。');
    }
    return scrcpy([], '无线投屏', mirrorSerial);
  };
  handlers['start-freecontrol'] = async () => openChecked(path.join(getResourceRoot(), 'bundled-tools', 'FreeControl.exe'), 'FreeControl');
  handlers['install-bundled-adb-driver'] = async () => openChecked(path.join(getResourceRoot(), 'bundled-tools', '安装ADB驱动.exe'), '内置 ADB 驱动');
  handlers['open-lan-share'] = async () => openChecked(path.join(getResourceRoot(), 'bundled-tools', '局域网共享精灵.exe'), '局域网共享工具');
  handlers['clone-downloads'] = async () => { await shell.openExternal('https://github.com/Xposed-Modules-Repo/io.github.vvb2060.mahoshojo/releases'); return ok('已打开分身/多用户工具下载页。'); };

  handlers['check-zygisk'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const commands = [
      ['su', '-c', shellArg('magisk -v')],
      ['su', '-c', shellArg('magisk --path')],
      ['getprop', 'ro.dalvik.vm.native.bridge'],
      ['su', '-c', shellArg('ls -ld /data/adb/modules/zygisksu /data/adb/modules/zygisk* 2>/dev/null')]
    ];
    const details = [];
    for (const args of commands) details.push(`adb shell ${args.join(' ')}\n${textOf(await adbFor(payload, ['shell', ...args])) || '无输出'}`);
    return ok(details.join('\n\n'));
  };
  handlers['configure-denylist-user-apps'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const enabled = await adbFor(payload, ['shell', 'su', '-c', shellArg('magisk --denylist enable')], { log: sendLog, timeoutMs: 10000 });
    if (enabled.code !== 0) return fail(`启用 Magisk DenyList 失败。请先确认 Magisk 已安装并允许 Root 授权。\n${textOf(enabled)}`);
    const listed = await adbFor(payload, ['shell', 'pm', 'list', 'packages', '--user', '0'], { log: sendLog });
    if (listed.code !== 0) return listed;
    const packages = lines(listed.stdout).map((line) => line.replace(/^package:/, '')).filter((pkg) => /^[A-Za-z0-9._]+$/.test(pkg));
    if (!packages.length) return fail('当前用户没有可加入 DenyList 的已安装应用。');
    const added = []; const failed = [];
    for (const pkg of packages) {
      const result = await adbFor(payload, ['shell', 'su', '-c', shellArg(`magisk --denylist add ${pkg} ${pkg}`)], { log: sendLog, timeoutMs: 10000 });
      if (result.code === 0 || /already|exist/i.test(textOf(result))) added.push(pkg);
      else failed.push(`${pkg}: ${textOf(result) || `退出码 ${result.code}`}`);
    }
    const summary = `已处理 ${packages.length} 个已安装应用：${added.length} 个已加入 DenyList${failed.length ? `，${failed.length} 个失败` : ''}。\n${added.join('\n')}`;
    return failed.length ? { code: 1, stdout: summary, stderr: failed.join('\n') } : ok(summary);
  };
  handlers['list-magisk-modules'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const result = await adbFor(payload, ['shell', 'su', '-c', shellArg('for d in /data/adb/modules/*; do [ -d "$d" ] || continue; echo "[$(basename "$d")]"; cat "$d/module.prop" 2>/dev/null; [ -f "$d/disable" ] && echo state=disabled || echo state=enabled; echo; done')], { timeoutMs: 10000 });
    return result.code === 0 ? ok(textOf(result) || '没有安装 Magisk 模块。') : result;
  };
  handlers['fastboot-continue'] = async () => (await requireFastboot()) || fastboot(['continue'], { log: sendLog });
  handlers['fastboot-getvar-all'] = async () => (await requireFastboot()) || fastboot(['getvar', 'all'], { log: sendLog });
  handlers['fastboot-unlock-status'] = async () => {
    const guard = await requireFastboot(); if (guard) return guard;
    const results = [];
    for (const args of [['oem', 'device-info'], ['getvar', 'unlocked'], ['getvar', 'secure']]) results.push(`fastboot ${args.join(' ')}\n${textOf(await fastboot(args))}`);
    return ok(results.join('\n\n'));
  };
  handlers['fastboot-set-active'] = async (payload) => {
    const guard = await requireFastboot(); if (guard) return guard;
    const slot = payload.slot === 'b' ? 'b' : 'a';
    return fastboot(['set_active', slot], { log: sendLog });
  };
  handlers['reboot-fastbootd'] = async () => {
    const status = await getStatus();
    if (status.mode === '系统模式') return adb(['reboot', 'fastboot'], { log: sendLog });
    if (status.mode === 'Fastboot') return fastboot(['reboot', 'fastboot'], { log: sendLog });
    return fail('需要 ADB 或 Fastboot 设备才能进入 FastbootD。', 2);
  };
  handlers['lenovo-unlock-go'] = async () => (await requireFastboot()) || fastboot(['oem', 'unlock-go'], { log: sendLog });
  handlers['moto-bl-unlock'] = async (payload) => {
    const guard = await requireFastboot(); if (guard) return guard;
    if (payload.mode === 'unlock') {
      const key = String(payload.unlockKey || '').trim();
      if (!/^[A-Za-z0-9._-]+$/.test(key)) return fail('执行解锁时必须填写 Motorola 官方 Unlock Key。');
      return fastboot(['oem', 'unlock', key], { log: sendLog });
    }
    const result = await fastboot(['oem', 'get_unlock_data'], { log: sendLog });
    const target = writeReport('Motorola解锁数据', textOf(result));
    await shell.openExternal('https://motorola-global-portal.custhelp.com/app/standalone/bootloader/unlock-your-device-a');
    await shell.openPath(target);
    return result.code === 0 ? ok(`解锁数据已保存并打开 Motorola 官网：${target}\n\n${textOf(result)}`) : result;
  };

  handlers['fix-adb-port'] = async () => {
    const stopped = await adb(['kill-server']);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const started = await adb(['start-server']);
    if (started.code !== 0) return fail(`ADB 5037 服务启动失败。\n${textOf(stopped)}\n${textOf(started)}`);
    const devices = await adb(['devices', '-l']);
    if (devices.code !== 0) return fail(`ADB 服务已启动，但设备查询失败。\n${textOf(devices)}`);
    return ok(`ADB 服务已重新绑定默认端口 5037。\n\n${textOf(started)}\n${textOf(devices)}`);
  };
  handlers['diagnose-baseband'] = async () => wirelessReport('基带与信号诊断');
  handlers['diagnose-wireless-stack'] = async () => wirelessReport('无线与基带深度检测');
  handlers['fix-wifi-after-flash'] = async () => {
    const guard = await requireAdb(); if (guard) return guard;
    const before = textOf(await adb(['shell', 'cmd', 'wifi', 'status']));
    await adb(['shell', 'svc', 'wifi', 'disable']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await adb(['shell', 'svc', 'wifi', 'enable']);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const scan = await adb(['shell', 'cmd', 'wifi', 'start-scan']);
    const after = await adb(['shell', 'cmd', 'wifi', 'status']);
    const networks = await adb(['shell', 'cmd', 'wifi', 'list-scan-results']);
    return ok(`修复前：\n${before}\n\n扫描命令：\n${textOf(scan)}\n\n修复后：\n${textOf(after)}\n\n热点：\n${textOf(networks).slice(0, 8000)}`);
  };
  handlers['fix-bluetooth-soft'] = async () => {
    const guard = await requireAdb(); if (guard) return guard;
    const before = await adb(['shell', 'dumpsys', 'bluetooth_manager']);
    await adb(['shell', 'cmd', 'bluetooth_manager', 'disable']);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await adb(['shell', 'cmd', 'bluetooth_manager', 'enable']);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = await adb(['shell', 'dumpsys', 'bluetooth_manager']);
    return ok(`修复前：\n${textOf(before).slice(0, 5000)}\n\n修复后：\n${textOf(after).slice(0, 5000)}`);
  };
  handlers['fix-voice-call-audio'] = async () => {
    const guard = await requireAdb(); if (guard) return guard;
    const packages = ['com.tencent.mm', 'com.openai.chatgpt'];
    const details = [];
    for (const pkg of packages) {
      for (const op of ['WAKE_LOCK', 'RUN_IN_BACKGROUND', 'RUN_ANY_IN_BACKGROUND', 'START_FOREGROUND', 'RECORD_AUDIO']) {
        details.push(`${pkg} ${op}: ${textOf(await adb(['shell', 'cmd', 'appops', 'set', '--user', '0', pkg, op, 'allow'])) || 'OK'}`);
      }
      await adb(['shell', 'cmd', 'deviceidle', 'whitelist', `+${pkg}`]);
    }
    for (const [stream, level] of [['0', '6'], ['3', '15'], ['6', '15'], ['10', '15']]) await adb(['shell', 'cmd', 'media_session', 'volume', '--stream', stream, '--set', level]);
    const audio = await adb(['shell', 'dumpsys', 'audio']);
    return ok(`${details.join('\n')}\n\n音频状态：\n${textOf(audio).slice(0, 10000)}`);
  };
  handlers['fix-tiktok-network'] = async () => {
    const guard = await requireAdb(); if (guard) return guard;
    const candidates = ['com.ss.android.ugc.trill', 'com.ss.android.ugc.aweme', 'com.zhiliaoapp.musically'];
    const installed = [];
    for (const pkg of candidates) if (lines((await adb(['shell', 'pm', 'path', pkg])).stdout).length) installed.push(pkg);
    if (!installed.length) return fail('主用户中未检测到 TikTok 或抖音。');
    const details = [];
    for (const pkg of installed) {
      const dump = textOf(await adb(['shell', 'dumpsys', 'package', pkg]));
      const uid = dump.match(/userId=(\d+)/)?.[1] || dump.match(/appId=(\d+)/)?.[1] || '';
      for (const args of [
        ['pm', 'unsuspend', '--user', '0', pkg], ['pm', 'enable', '--user', '0', pkg],
        ['cmd', 'appops', 'set', '--user', '0', pkg, 'RUN_IN_BACKGROUND', 'allow'],
        ['cmd', 'appops', 'set', '--user', '0', pkg, 'RUN_ANY_IN_BACKGROUND', 'allow'],
        ['cmd', 'deviceidle', 'whitelist', `+${pkg}`]
      ]) details.push(`${pkg}: ${textOf(await adb(['shell', ...args])) || 'OK'}`);
      if (uid) await adb(['shell', 'cmd', 'netpolicy', 'add', 'restrict-background-whitelist', uid]);
      await adb(['shell', 'am', 'force-stop', pkg]);
      details.push(textOf(await adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'])));
    }
    return ok(details.join('\n'));
  };

  handlers['install-users-manager'] = async () => installFiles([path.join(getResourceRoot(), 'bundled-tools', 'UsersManager_1.6.apk')].filter(fs.existsSync), '用户管理器');
  handlers['install-aiwanji-toolbox'] = async () => installFiles([path.join(getResourceRoot(), 'bundled-tools', '爱玩机工具箱_S-22.0.9.7.apk')].filter(fs.existsSync), '爱玩机工具箱');
  handlers['install-lenovo-deep-test'] = async () => installFiles([path.join(getResourceRoot(), 'bundled-tools', '深度测试.apk')].filter(fs.existsSync), '联想深度测试');
  handlers['install-clone-tools'] = async () => installFiles([
    path.join(getResourceRoot(), 'bundled-tools', 'UsersManager_1.6.apk'),
    path.join(getResourceRoot(), 'bundled-tools', '爱玩机工具箱_S-22.0.9.7.apk')
  ].filter(fs.existsSync), '分身工具');
  handlers['install-lenovo-9008-driver'] = async () => openChecked(path.join(getResourceRoot(), 'bundled-tools', '9008_LenovoUsbDriver_autorun_1.0.18.exe'), '联想 9008 驱动');

  async function prepareQpst() {
    const archive = path.join(getResourceRoot(), 'bundled-tools', 'QPST.2.7.496.zip');
    if (!fs.existsSync(archive)) return { error: fail(`缺少 QPST 资源：${archive}`) };
    const dir = path.join(app.getPath('userData'), 'tools', 'QPST.2.7.496');
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).length) {
      const extracted = await extractArchive(archive, dir);
      if (extracted.code !== 0) return { error: extracted };
    }
    return { dir };
  }
  handlers['open-qpst-tools'] = async () => {
    const prepared = await prepareQpst(); if (prepared.error) return prepared.error;
    const executables = walkFiles(prepared.dir, ['.exe']);
    const preferred = executables.find((file) => /qfil\.exe$/i.test(file)) || executables.find((file) => /setup.*\.exe$/i.test(file));
    return preferred ? openChecked(preferred, path.basename(preferred)) : openChecked(prepared.dir, 'QPST 解压目录');
  };
  handlers['edl-9008-console'] = async () => {
    const driver = path.join(getResourceRoot(), 'bundled-tools', '9008_LenovoUsbDriver_autorun_1.0.18.exe');
    const prepared = await prepareQpst(); if (prepared.error) return prepared.error;
    const error = await shell.openPath(prepared.dir);
    if (error) return fail(`9008 工具目录打开失败：${error}`);
    return ok(`9008 工具目录已打开：${prepared.dir}\n驱动：${driver}\n请先在设备管理器确认 Qualcomm HS-USB QDLoader 9008，再使用 QFIL。`);
  };

  handlers['extract-payload-bin'] = async () => {
    const files = await chooseFiles({ title: '选择包含 payload.bin 的 OTA ZIP', filters: [{ name: 'OTA ZIP', extensions: ['zip'] }] });
    if (!files[0]) return fail('已取消。');
    const listing = await runProcess('tar.exe', ['-tf', files[0]], { cwd: path.dirname(files[0]) });
    if (listing.code !== 0) return listing;
    const entries = lines(listing.stdout); const payloadEntry = entries.find((entry) => /(^|\/)payload\.bin$/i.test(entry));
    if (!payloadEntry) return fail('ZIP 中未找到 payload.bin。');
    const dir = path.join(outputRoot(), 'payload_bin', `${path.basename(files[0], '.zip')}_${stamp()}`); fs.mkdirSync(dir, { recursive: true });
    const extracted = await runProcess('tar.exe', ['-xf', files[0], '-C', dir, payloadEntry], { cwd: dir, log: sendLog });
    if (extracted.code !== 0) return extracted;
    const source = path.join(dir, payloadEntry); const target = path.join(dir, 'payload.bin');
    if (source !== target) { fs.copyFileSync(source, target); }
    const report = `来源：${files[0]}\n输出：${target}\n大小：${fs.statSync(target).size}\nSHA256：${hashFile(target)}`;
    fs.writeFileSync(path.join(dir, 'payload_extract_report.txt'), report, 'utf8'); await shell.openPath(dir);
    return ok(report);
  };

  handlers['backup-key-partitions'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const parts = ['boot_a', 'boot_b', 'init_boot_a', 'init_boot_b', 'vendor_boot_a', 'vendor_boot_b', 'vbmeta_a', 'vbmeta_b', 'dtbo_a', 'dtbo_b'];
    const dir = path.join(outputRoot(), '关键分区备份', stamp()); fs.mkdirSync(dir, { recursive: true });
    const details = [];
    for (const part of parts) {
      const find = await adbFor(payload, ['shell', 'su', '-c', shellArg(`for d in /dev/block/by-name /dev/block/bootdevice/by-name /dev/block/platform/*/by-name; do [ -e "$d/${part}" ] && echo "$d/${part}" && exit 0; done; exit 1`)], { timeoutMs: 10000 });
      const device = lines(find.stdout)[0]; if (!device) { details.push(`${part}：不存在`); continue; }
      const remote = `/sdcard/adb_gaoji_${part}.img`;
      const copied = await adbFor(payload, ['shell', 'su', '-c', shellArg(`dd if="${device}" of=${remote} bs=4M && chmod 644 ${remote}`)], { timeoutMs: 120000 });
      if (copied.code !== 0) { details.push(`${part}：读取失败 ${textOf(copied)}`); continue; }
      const local = path.join(dir, `${part}.img`); const pulled = await adbFor(payload, ['pull', remote, local], { log: sendLog }); await adbFor(payload, ['shell', 'rm', '-f', remote]);
      details.push(`${part}：${pulled.code === 0 ? `已备份 ${local} SHA256=${hashFile(local)}` : textOf(pulled)}`);
    }
    fs.writeFileSync(path.join(dir, '备份报告.txt'), details.join('\n'), 'utf8'); await shell.openPath(dir);
    return details.some((line) => line.includes('已备份')) ? ok(details.join('\n')) : fail(details.join('\n'));
  };
  handlers['bootlogo-diagnose'] = async () => {
    const status = await getStatus(); const details = [`连接模式：${status.mode}`];
    if (status.mode === '系统模式') details.push(textOf(await adb(['shell', 'su', '-c', shellArg('ls -l /dev/block/by-name 2>/dev/null | grep -Ei "logo|splash|boot"')], { timeoutMs: 10000 })));
    if (status.mode === 'Fastboot') details.push(textOf(await fastboot(['getvar', 'all'])));
    return ok(details.join('\n'));
  };

  handlers['bootanim-backup'] = async (payload) => backupBootAnimation(payload);
  handlers['bootanim-extract-portable'] = async (payload) => backupBootAnimation(payload, '便携开机动画');
  handlers['bootanim-compat-check'] = async () => {
    const file = await chooseBootZip('选择要检查的 bootanimation.zip'); if (!file) return fail('已取消。');
    const inspected = await inspectBootZip(file); return inspected.valid ? ok(inspected.detail) : fail(inspected.detail);
  };
  handlers['bootanim-install-zip'] = async (payload) => { const guard = await requireSelectedAdb(payload); if (guard) return guard; const file = await chooseBootZip('选择 bootanimation.zip'); return file ? installBootZip(payload, file) : fail('已取消。'); };
  handlers['bootanim-install-checked'] = handlers['bootanim-install-zip'];
  handlers['bootanim-restore'] = async (payload) => { const guard = await requireSelectedAdb(payload); if (guard) return guard; const file = await chooseBootZip('选择之前备份的 bootanimation.zip'); return file ? installBootZip(payload, file) : fail('已取消。'); };
  function latestLocalBootAnimation() {
    const dir = path.join(outputRoot(), '开机动画备份'); fs.mkdirSync(dir, { recursive: true });
    const files = walkFiles(dir, ['.zip']).map((file) => ({ file, mtime: fs.statSync(file).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
    return { dir, latest: files[0] || null };
  }
  handlers['bootanim-check-latest-portable'] = async () => {
    const { dir, latest } = latestLocalBootAnimation();
    return latest ? ok(`最新本地动画包：${latest.file}\n修改时间：${new Date(latest.mtime).toLocaleString('zh-CN')}\nSHA256：${hashFile(latest.file)}`) : fail(`尚无本地动画包，请先执行“提取当前开机动画”。\n目录：${dir}`);
  };
  handlers['bootanim-install-latest-portable'] = async (payload) => {
    const guard = await requireSelectedAdb(payload); if (guard) return guard;
    const { dir, latest } = latestLocalBootAnimation();
    if (!latest) return fail(`没有可安装的本地动画包。请先备份或提取当前开机动画。\n目录：${dir}`);
    return installBootZip(payload, latest.file);
  };

  async function deviceScreenSize() {
    const guard = await requireAdb(); if (guard) return { error: guard };
    const size = textOf(await adb(['shell', 'wm', 'size'])); const match = size.match(/(?:Physical size|Override size):\s*(\d+)x(\d+)/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1080, height: 2400 };
  }
  async function makeAnimationFromFrames(frameFiles, name) {
    if (!frameFiles.length) return fail('没有选择图片。');
    const size = await deviceScreenSize(); if (size.error) return size.error;
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-gaoji-bootanim-')); const part = path.join(stage, 'part0'); fs.mkdirSync(part);
    frameFiles.forEach((file, index) => fs.copyFileSync(file, path.join(part, `${String(index).padStart(5, '0')}${path.extname(file).toLowerCase()}`)));
    fs.writeFileSync(path.join(stage, 'desc.txt'), `${size.width} ${size.height} 30\np 0 0 part0\n`, 'ascii');
    const target = uniqueOutputPath(outputRoot(), `${name}.zip`);
    const packed = await runProcess('tar.exe', ['-a', '-cf', target, '--options', 'zip:compression=store', '-C', stage, 'desc.txt', 'part0'], { cwd: stage, log: sendLog });
    if (packed.code !== 0) return packed;
    return ok(`开机动画已制作：${target}\n帧数：${frameFiles.length}\n分辨率：${size.width}x${size.height}\nSHA256：${hashFile(target)}`);
  }
  handlers['bootanim-image'] = async () => makeAnimationFromFrames(await chooseFiles({ title: '选择开机动画图片（按文件名排序）', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multiple: true }), '图片开机动画');
  handlers['bootanim-video'] = async () => {
    const files = await chooseFiles({ title: '选择视频', filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }] }); if (!files[0]) return fail('已取消。');
    const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-gaoji-video-frames-'));
    const extracted = await runProcess('ffmpeg.exe', ['-i', files[0], '-vf', 'fps=30', path.join(frameDir, '%05d.png')], { cwd: frameDir, log: sendLog });
    if (extracted.code !== 0) return fail(`ffmpeg 提取视频帧失败。请确认电脑已安装 ffmpeg。\n${textOf(extracted)}`);
    return makeAnimationFromFrames(walkFiles(frameDir, ['.png']).sort(), '视频开机动画');
  };

  handlers['tea-clone-runtime-fix'] = async () => {
    const guard = await requireAdb(); if (guard) return guard;
    const packages = ['com.xt00ls.tea.seed', 'com.xt00ls.tea.green', 'com.xt00ls.tea.leaf', 'com.xt00ls.tea.congou', 'com.xt00ls.tea.xsound', 'com.xt00ls.tea.transcoder'];
    const details = [];
    for (const pkg of packages) {
      await adb(['shell', 'pm', 'enable', '--user', '0', pkg]);
      await adb(['shell', 'pm', 'unsuspend', '--user', '0', pkg]);
      await adb(['shell', 'cmd', 'deviceidle', 'whitelist', `+${pkg}`]);
      details.push(`${pkg}：已执行启用、解除暂停和省电白名单。`);
    }
    const users = await adb(['shell', 'pm', 'list', 'users']);
    return ok(`${details.join('\n')}\n\n用户空间：\n${textOf(users)}`);
  };
  handlers['rescue-diagnose'] = async () => diagnosticReport('救砖路径分析', true);
  handlers['flash-compatibility-gate'] = async () => {
    const firmware = getSelectedFirmware(); if (!firmware?.xmlPath) return fail('请先在固件刷机页面选择刷机包。');
    const status = await getStatus();
    const report = `刷机包：${firmware.xmlPath}\n设备模式：${status.mode}\n设备：${status.props?.manufacturer || '-'} ${status.props?.model || '-'} / ${status.props?.device || '-'}\n槽位：${status.props?.slot || '-'}\n\n兼容总闸已确认刷机包存在；仍需人工核对 XML 中 product 与当前设备代号。`;
    return fs.existsSync(firmware.xmlPath) ? ok(report) : fail(`刷机 XML 不存在：${firmware.xmlPath}`);
  };
  handlers['preview-flash'] = async () => ({ code: 0, stdout: '已切换到固件刷机页面，请点击“解析命令”查看完整写入序列。', stderr: '', navigate: 'firmware' });
  handlers['resume-flash'] = async () => ({ code: 0, stdout: '已恢复到固件刷机页面。重新解析命令后，程序会从头执行并在首个失败步骤停止；不会盲目跳过失败命令。', stderr: '', navigate: 'firmware' });

  return handlers;
}

module.exports = { ACTION_IDS, createActionHandlers, parseWirelessEndpoint, parseWirelessPairingRequest, shellArg };
