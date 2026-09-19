const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PACKAGE_PATTERN,
  packageNameFromFile,
  packageNameFromApk,
  packageFromBinaryManifest,
  packageFromStringPool,
  readZipEntry,
  readStringPool,
  listZipEntries
} = require('../src/apk_package_reader');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE_APK = path.join(ROOT, 'resources', 'bundled-tools', 'UsersManager_1.6.apk');
const SAMPLE_APK2 = path.join(ROOT, 'resources', 'apk', 'app-query-helper.apk');
const hasSamples = fs.existsSync(SAMPLE_APK) && fs.existsSync(SAMPLE_APK2);

test('PACKAGE_PATTERN 只接受反向域名', () => {
  assert.equal(PACKAGE_PATTERN.test('com.xj.UsersManager'), true);
  assert.equal(PACKAGE_PATTERN.test('com.a.b.c'), true);
  assert.equal(PACKAGE_PATTERN.test('single'), false);
  assert.equal(PACKAGE_PATTERN.test('com..x'), false);
  assert.equal(PACKAGE_PATTERN.test('1com.x'), false);
  assert.equal(PACKAGE_PATTERN.test('com.x y'), false);
  assert.equal(PACKAGE_PATTERN.test(''), false);
});

test('readZipEntry 能取出 APK 内的 AndroidManifest.xml', { skip: !hasSamples }, () => {
  const buf = fs.readFileSync(SAMPLE_APK);
  const xml = readZipEntry(buf, 'AndroidManifest.xml');
  assert.ok(xml, '应能读到 AndroidManifest.xml');
  assert.ok(xml.length > 100, '清单不应为空');
  // 二进制 XML 的文件头 magic 是 0x0003
  assert.equal(xml.readUInt16LE(0), 0x0003);
});

test('readZipEntry 对不存在的条目返回 null', { skip: !hasSamples }, () => {
  const buf = fs.readFileSync(SAMPLE_APK);
  assert.equal(readZipEntry(buf, '不存在的文件.txt'), null);
});

test('listZipEntries 列出 APK 内部条目', { skip: !hasSamples }, () => {
  const names = listZipEntries(fs.readFileSync(SAMPLE_APK));
  assert.ok(names.includes('AndroidManifest.xml'));
  assert.ok(names.includes('classes.dex') || names.some((n) => n.startsWith('classes')));
});

test('readStringPool 取出清单字符串', { skip: !hasSamples }, () => {
  const xml = readZipEntry(fs.readFileSync(SAMPLE_APK), 'AndroidManifest.xml');
  const strings = readStringPool(xml);
  assert.ok(strings.length > 10, `字符串池应有多条，实际 ${strings.length}`);
  assert.ok(strings.includes('manifest'));
  assert.ok(strings.includes('package'));
});

test('packageFromBinaryManifest 从真实清单取到包名', { skip: !hasSamples }, () => {
  const xml = readZipEntry(fs.readFileSync(SAMPLE_APK), 'AndroidManifest.xml');
  assert.equal(packageFromBinaryManifest(xml), 'com.xj.UsersManager');
});

test('packageFromStringPool 兜底不会取到库声明或权限名', { skip: !hasSamples }, () => {
  const xml = readZipEntry(fs.readFileSync(SAMPLE_APK), 'AndroidManifest.xml');
  const pkg = packageFromStringPool(xml);
  // 这条是回归用例。第一版兜底逻辑按"最短优先"，结果返回了
  // org.apache.http.legacy（某个库在清单里的声明），完全不是应用包名。
  assert.equal(pkg, 'com.xj.UsersManager');
  // 包名本身可以含大写（Android 不要求全小写），
  // 但不应取到权限、动作或类名这类明显非包名的条目
  assert.ok(!/permission|intent|action|category/i.test(pkg), `不应取到权限/动作名：${pkg}`);
  assert.ok(!/^(android|androidx|java|kotlin|org\.)/.test(pkg), `不应取到框架或库前缀：${pkg}`);
});

test('packageNameFromApk 读取真实 APK 包名', { skip: !hasSamples }, () => {
  assert.equal(packageNameFromApk(SAMPLE_APK), 'com.xj.UsersManager');
  assert.equal(packageNameFromApk(SAMPLE_APK2), 'com.codex.adbgaoji.packagequery');
});

test('packageNameFromFile 对 .apk 与不存在的文件都能安全返回', () => {
  assert.equal(packageNameFromFile(path.join(ROOT, '不存在的.apk')), '');
  assert.equal(packageNameFromFile(''), '');
});

test('packageNameFromFile 对非 zip 文件不抛异常', () => {
  const tmp = path.join(require('node:os').tmpdir(), `not-a-zip-${Date.now()}.apk`);
  fs.writeFileSync(tmp, 'this is not a zip file');
  try {
    assert.equal(packageNameFromFile(tmp), '');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('对损坏的清单不抛异常', () => {
  assert.equal(packageFromBinaryManifest(Buffer.alloc(0)), '');
  assert.equal(packageFromBinaryManifest(Buffer.from([1, 2, 3])), '');
  assert.deepEqual(readStringPool(Buffer.alloc(4)), []);
  assert.equal(packageFromStringPool(Buffer.alloc(8)), '');
});

test('多个真实 APK 的包名全部解析成功', { skip: !hasSamples }, () => {
  const candidates = [
    path.join(ROOT, 'resources', 'bundled-tools', '深度测试.apk'),
    path.join(ROOT, 'resources', 'bundled-tools', '爱玩机工具箱_S-22.0.9.7.apk'),
    path.join(ROOT, 'resources', 'apk', 'alpha.apk')
  ].filter((f) => fs.existsSync(f));
  assert.ok(candidates.length >= 1, '至少应有一个样本');
  for (const file of candidates) {
    const pkg = packageNameFromFile(file);
    const name = path.basename(file);
    assert.ok(PACKAGE_PATTERN.test(pkg), `${name} 解析结果不合法：${pkg}`);
    // 不能取到权限、动作、框架或库
    assert.ok(!/permission|intent|action|category/i.test(pkg), `${name} 取到了权限/动作名：${pkg}`);
    assert.ok(!/^(android|androidx|java|kotlin|org\.)/.test(pkg), `${name} 取到了框架/库前缀：${pkg}`);
  }
});
