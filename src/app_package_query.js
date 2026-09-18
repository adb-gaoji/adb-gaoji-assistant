const fs = require('fs');
const path = require('path');

const HELPER_PACKAGE = 'com.codex.adbgaoji.packagequery';
const HELPER_VERSION = 2;
const HELPER_URI = 'content://com.codex.adbgaoji.packagequery.apps';
const HELPER_ACTIVITY = `${HELPER_PACKAGE}/.BootstrapActivity`;
const PACKAGE_RE = /^[A-Za-z0-9._]+$/;
const SERIAL_RE = /^[A-Za-z0-9._:-]+$/;

function parseJsonArray(text, label) {
  const match = String(text || '').match(new RegExp(`^\\s*${label}:\\s*(\\[[^\\r\\n]*\\])`, 'm'));
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}

function parseByteField(text, label) {
  const match = String(text || '').match(new RegExp(`^\\s*${label}:\\s*(\\d+)`, 'm'));
  return match ? Number(match[1]) : 0;
}

function parseDiskStats(text) {
  const source = String(text || '');
  const freeMatch = source.match(/^\s*Data-Free:\s*(\d+)K\s*\/\s*(\d+)K/m);
  const packageNames = parseJsonArray(source, 'Package Names');
  const appSizes = parseJsonArray(source, 'App Sizes');
  const appDataSizes = parseJsonArray(source, 'App Data Sizes');
  const cacheSizes = parseJsonArray(source, 'Cache Sizes');
  const packages = {};
  packageNames.forEach((packageName, index) => {
    if (!PACKAGE_RE.test(packageName)) return;
    const codeBytes = Number(appSizes[index]) || 0;
    const dataBytes = Number(appDataSizes[index]) || 0;
    const cacheBytes = Number(cacheSizes[index]) || 0;
    packages[packageName] = { codeBytes, dataBytes, cacheBytes, totalBytes: codeBytes + dataBytes + cacheBytes };
  });
  const codeBytes = parseByteField(source, 'App Size');
  const dataBytes = parseByteField(source, 'App Data Size');
  const cacheBytes = parseByteField(source, 'App Cache Size');
  const totalBytes = freeMatch ? Number(freeMatch[2]) * 1024 : 0;
  const freeBytes = freeMatch ? Number(freeMatch[1]) * 1024 : 0;
  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    appsBytes: codeBytes + dataBytes + cacheBytes,
    photosBytes: parseByteField(source, 'Photos Size'),
    videosBytes: parseByteField(source, 'Videos Size'),
    audioBytes: parseByteField(source, 'Audio Size'),
    downloadsBytes: parseByteField(source, 'Downloads Size'),
    cacheBytes,
    systemBytes: parseByteField(source, 'System Size'),
    otherBytes: parseByteField(source, 'Other Size'),
    packages
  };
}

function parseStorageFileRows(text) {
  return String(text || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\d+):(\/.*)$/);
    return match ? [{ bytes: Number(match[1]), path: match[2] }] : [];
  });
}

function summarizeFiles(files, predicate) {
  const matching = files.filter(predicate);
  return { count: matching.length, bytes: matching.reduce((sum, item) => sum + item.bytes, 0) };
}

function findFileStatsArgs(serial, roots) {
  return deviceArgs(serial, ['shell', 'find', ...roots, '-type', 'f', '-exec', 'stat', '-c', '%s:%n', '{}', '\\;']);
}

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.dng']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.3gp', '.m4v']);
const JUNK_EXTENSIONS = new Set(['.apk', '.apks', '.xapk', '.apkm', '.tmp', '.temp', '.log', '.bak']);

function deviceArgs(serial, args) {
  if (!SERIAL_RE.test(String(serial || ''))) throw new Error('没有选择有效的 ADB 设备。');
  return ['-s', serial, ...args];
}

function parsePackageRows(text) {
  return String(text || '').split(/\r?\n/).flatMap((line) => {
    if (!/^Row:\s*\d+\s+/.test(line)) return [];
    const fields = Object.fromEntries(line.replace(/^Row:\s*\d+\s+/, '').split(', ').map((part) => {
      const index = part.indexOf('=');
      return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    }));
    if (!PACKAGE_RE.test(fields.package_name || '')) return [];
    const decode = (value) => {
      try { return Buffer.from(value || '', 'base64').toString('utf8'); } catch { return ''; }
    };
    const enabled = fields.enabled === '1';
    const suspended = fields.suspended === '1';
    return [{
      label: decode(fields.label_b64) || fields.package_name,
      packageName: fields.package_name,
      versionName: decode(fields.version_name_b64),
      system: fields.is_system === '1',
      enabled,
      suspended,
      frozen: !enabled || suspended,
      storage: fields.storage === 'external' ? 'external' : 'internal',
      launchable: fields.launchable === '1'
    }];
  });
}

function parseVersionCode(text) {
  const match = String(text || '').match(/versionCode=(\d+)/);
  return match ? Number(match[1]) : 0;
}

function createAppPackageQuery({ adb, getResourceRoot, sendLog = () => undefined }) {
  const fail = (stderr, code = 1) => ({ code, stdout: '', stderr: String(stderr || '应用列表读取失败。') });

  async function install(serial, apk) {
    let result = await adb(deviceArgs(serial, ['install', '-r', apk]), { timeoutMs: 60000, log: sendLog });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.code !== 0 && /INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(output)) {
      const removed = await adb(deviceArgs(serial, ['uninstall', HELPER_PACKAGE]), { timeoutMs: 30000, log: sendLog });
      if (removed.code !== 0) return removed;
      result = await adb(deviceArgs(serial, ['install', apk]), { timeoutMs: 60000, log: sendLog });
    }
    return result;
  }

  async function run(payload = {}) {
    const serial = String(payload.serial || '');
    if (!SERIAL_RE.test(serial)) return fail('没有选择有效的 ADB 设备。', 2);
    const apk = path.join(getResourceRoot(), 'apk', 'app-query-helper.apk');
    if (!fs.existsSync(apk) || fs.statSync(apk).size === 0) return fail(`缺少内置应用查询助手：${apk}`);

    const current = await adb(deviceArgs(serial, ['shell', 'dumpsys', 'package', HELPER_PACKAGE]), { timeoutMs: 15000 });
    if (parseVersionCode(current.stdout) !== HELPER_VERSION) {
      const installed = await install(serial, apk);
      if (installed.code !== 0) return fail(`应用查询助手安装失败：${installed.stderr || installed.stdout}`);
    }

    const started = await adb(deviceArgs(serial, ['shell', 'am', 'start', '-W', '-n', HELPER_ACTIVITY]), { timeoutMs: 15000, log: sendLog });
    if (started.code !== 0) return fail(`应用查询助手启动失败：${started.stderr || started.stdout}`);

    const queried = await adb(deviceArgs(serial, ['shell', 'content', 'query', '--uri', HELPER_URI]), { timeoutMs: 30000, log: sendLog });
    const queryOutput = `${queried.stdout || ''}\n${queried.stderr || ''}`;
    if (/Error while accessing provider|Could not find provider/i.test(queryOutput)) {
      return fail('应用查询助手启动后仍被系统拦截，请允许“ADB搞机助手应用查询组件”自启动后重试。');
    }
    if (queried.code !== 0) return fail(`应用列表读取失败：${queried.stderr || queried.stdout}`);
    const apps = parsePackageRows(queried.stdout);
    if (!apps.length) return fail('应用查询助手未返回任何应用。');
    const diskResult = await adb(deviceArgs(serial, ['shell', 'dumpsys', 'diskstats']), { timeoutMs: 30000 });
    const diskStats = diskResult.code === 0 ? parseDiskStats(diskResult.stdout) : null;
    if (diskStats) {
      for (const item of apps) {
        const size = diskStats.packages[item.packageName];
        item.sizeBytes = size?.totalBytes || 0;
        item.dataBytes = size?.dataBytes || 0;
        item.cacheBytes = size?.cacheBytes || 0;
      }
    }
    return { code: 0, stdout: `读取到 ${apps.length} 个应用。`, stderr: '', data: { apps } };
  }

  async function storage(payload = {}) {
    const serial = String(payload.serial || '');
    if (!SERIAL_RE.test(serial)) return fail('没有选择有效的 ADB 设备。', 2);
    const result = await adb(deviceArgs(serial, ['shell', 'dumpsys', 'diskstats']), { timeoutMs: 30000, log: sendLog });
    if (result.code !== 0) return fail(`存储空间读取失败：${result.stderr || result.stdout}`);
    const storage = parseDiskStats(result.stdout);
    if (!storage.totalBytes) return fail('手机系统没有返回可用的存储统计。');
    const [mediaScan, junkScan] = await Promise.all([
      adb(findFileStatsArgs(serial, ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Movies']), { timeoutMs: 60000, log: sendLog }),
      adb(findFileStatsArgs(serial, ['/sdcard/Download', '/sdcard/Documents', '/sdcard/.Trash', '/sdcard/DCIM/.thumbnails']), { timeoutMs: 60000, log: sendLog })
    ]);
    const mediaFiles = parseStorageFileRows(mediaScan.stdout);
    const junkFiles = parseStorageFileRows(junkScan.stdout);
    const photos = summarizeFiles(mediaFiles, (item) => !item.path.includes('/.thumbnails/') && PHOTO_EXTENSIONS.has(path.extname(item.path).toLowerCase()));
    const videos = summarizeFiles(mediaFiles, (item) => VIDEO_EXTENSIONS.has(path.extname(item.path).toLowerCase()));
    const junk = summarizeFiles(junkFiles, (item) => item.path.includes('/.Trash/') || item.path.includes('/.thumbnails/') || JUNK_EXTENSIONS.has(path.extname(item.path).toLowerCase()));
    const packages = Object.values(storage.packages);
    storage.categories = {
      apps: { count: packages.length, bytes: storage.appsBytes, unit: '个应用', paths: ['Android 应用数据'] },
      photos: { ...photos, unit: '个文件', paths: ['/sdcard/DCIM', '/sdcard/Pictures'] },
      videos: { ...videos, unit: '个文件', paths: ['/sdcard/DCIM', '/sdcard/Movies', '/sdcard/Pictures'] },
      cache: { count: packages.filter((item) => item.cacheBytes > 0).length, bytes: storage.cacheBytes, unit: '个应用', paths: ['应用缓存'] },
      junk: { ...junk, unit: '个文件', paths: ['/sdcard/Download', '/sdcard/Documents', '/sdcard/.Trash', '/sdcard/DCIM/.thumbnails'] }
    };
    storage.fileScanComplete = mediaScan.code === 0 && junkScan.code === 0;
    const warning = storage.fileScanComplete ? '' : ' 部分不存在或不可访问的公共目录已跳过。';
    return { code: 0, stdout: `存储空间扫描完成。${warning}`, stderr: '', data: { storage } };
  }

  return { run, storage };
}

module.exports = { HELPER_PACKAGE, HELPER_VERSION, parsePackageRows, parseDiskStats, parseStorageFileRows, createAppPackageQuery };
