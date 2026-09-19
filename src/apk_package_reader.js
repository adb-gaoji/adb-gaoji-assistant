/**
 * 从 APK / APKS 中读取包名。
 *
 * 为什么需要它：安装时要判断"这个包原本装在哪些分身里"，
 * 就必须在安装**之前**知道包名。而：
 *   - `adb install` 的输出只有一行 `Success`，不带包名
 *     （平台工具 35 上 `-v` 参数还会被设备拒绝：Unknown option -v）
 *   - "安装前后差分包列表"对覆盖安装无效——升级时包名不变，差分查不到
 *   - 仓库里没有 aapt / aapt2，也不适合为此引入几十 MB 的工具
 *
 * 因此直接读 APK 里的二进制 AndroidManifest.xml。
 *
 * 二进制 XML 的结构（AOSP resource 格式）：
 *   文件头: magic(0x0003) size  —— 这里不校验，靠字符串池特征定位更稳
 *   字符串池 chunk: type=0x0001，内含 UTF-16LE 字符串数组
 *   起始标签 chunk (0x0102) 的 name 指向 "manifest"，
 *   随后是若干属性；其中 name 指向 "package" 的属性，
 *   其 rawValue（或 typedValue 的字符串引用）就是包名。
 *
 * 实现上不追求完整解析整个 chunk 树——包名一定同时出现在字符串池里，
 * 且形如反向域名。用"字符串池 + manifest 起始标签"交叉验证即可，
 * 比完整实现一套 chunk 解析器更不容易在奇怪机型上出错。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** 反向域名形式的包名：至少两段，只含合法字符。 */
const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/**
 * 极简 ZIP 读取：只取指定名字的条目内容。
 *
 * 不引第三方库，是因为只需要读一个固定名字的小文件，
 * 而已有的 tar.exe 方案在 Windows 上对 APK（zip）可用但会落盘，
 * 这里在内存里读更快也更容易测。
 */
function readZipEntry(buffer, wantedName) {
  // 从尾部找 End of Central Directory（EOCD 签名 0x06054b50）
  let eocd = -1;
  const minEocd = 22;
  for (let i = buffer.length - minEocd; i >= 0 && i > buffer.length - 65558; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length) return null;
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null; // central dir 签名
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === wantedName) {
      // 读 local file header 拿到真实数据起点
      if (localOffset + 30 > buffer.length) return null;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return data;                       // stored
      if (method === 8) return zlib.inflateRawSync(data);  // deflate
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** 解析二进制 XML 的字符串池，返回所有 UTF-16LE 字符串。 */
function readStringPool(xml) {
  // 字符串池 chunk 紧跟文件头（8 字节）之后
  if (xml.length < 16) return [];
  if (xml.readUInt16LE(0) !== 0x0003) return [];  // RES_XML_TYPE
  const poolOffset = 8;
  if (xml.readUInt16LE(poolOffset) !== 0x0001) return []; // RES_STRING_POOL_TYPE

  const chunkSize = xml.readUInt32LE(poolOffset + 4);
  const stringCount = xml.readUInt32LE(poolOffset + 8);
  const flags = xml.readUInt32LE(poolOffset + 16);
  const stringsStart = xml.readUInt32LE(poolOffset + 20);
  const isUtf8 = (flags & (1 << 8)) !== 0;
  const offsetsBase = poolOffset + 28;

  const strings = [];
  for (let i = 0; i < stringCount && i < 100000; i++) {
    const stringOffset = xml.readUInt32LE(offsetsBase + i * 4);
    const at = poolOffset + stringsStart + stringOffset;
    if (at >= poolOffset + chunkSize || at >= xml.length) { strings.push(''); continue; }
    if (isUtf8) {
      // UTF-8 变长长度前缀
      let p = at;
      let len = xml[p++];
      if (len & 0x80) { len = ((len & 0x7f) << 8) | xml[p++]; }
      let byteLen = xml[p++];
      if (byteLen & 0x80) { byteLen = ((byteLen & 0x7f) << 8) | xml[p++]; }
      strings.push(xml.toString('utf8', p, p + byteLen));
    } else {
      let p = at;
      let len = xml.readUInt16LE(p); p += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | xml.readUInt16LE(p); p += 2; }
      strings.push(xml.toString('utf16le', p, p + len * 2));
    }
  }
  return strings;
}

/**
 * 从 AndroidManifest.xml（二进制）中取包名。
 *
 * 结构（AOSP ResXMLTree）：
 *   ResChunk_header  : type(2) headerSize(2) size(4)   —— 8 字节
 *   ResXMLTree_node  : header(8) lineNumber(4) comment(4) —— 共 16 字节
 *   之后是 ResXMLTree_attrExt（仅起始标签有）：
 *     ns(4) name(4) attributeStart(2) attributeSize(2) attributeCount(2)
 *     idIndex(2) classIndex(2) styleIndex(2)
 *   属性区起点 = 节点起点 + 16 + attributeStart
 *   单个属性 ResXMLTree_attribute（20 字节）：
 *     ns(4) name(4) rawValue(4) typedValue{ size(2) res0(1) dataType(1) data(4) }
 *
 * 之前一版把属性区起点写成固定偏移，漏了 attributeStart 这个字段，
 * 于是在有的 APK 上读到了别的字符串。现在按真实布局计算，
 * 并用 attributeSize 兜底（不同版本该值理论上是 20，但按字段读更稳）。
 */
function packageFromBinaryManifest(xml) {
  const strings = readStringPool(xml);
  if (!strings.length) return '';

  const manifestIdx = strings.indexOf('manifest');
  const packageIdx = strings.indexOf('package');
  if (manifestIdx < 0 || packageIdx < 0) return '';
  const androidNs = strings.indexOf('http://schemas.android.com/apk/res/android');

  // 遍历顶层 chunk，找 name 指向 "manifest" 的起始标签
  let offset = 8;
  while (offset + 16 <= xml.length) {
    const type = xml.readUInt16LE(offset);
    const headerSize = xml.readUInt16LE(offset + 2);
    const size = xml.readUInt32LE(offset + 4);
    if (size <= 0 || offset + size > xml.length) break;

    if (type === 0x0102) { // RES_XML_START_ELEMENT_TYPE
      // ResXMLTree_node 布局（headerSize 已包含 16 字节节点头）：
      //   偏移 0  : ResChunk_header (type 2 + headerSize 2 + size 4)
      //   偏移 8  : lineNumber (4)
      //   偏移 12 : comment (4)
      //   偏移 16 : ResXMLTree_attrExt 起始
      //             ns(4) name(4) attributeStart(2) attributeSize(2)
      //             attributeCount(2) idIndex(2) classIndex(2) styleIndex(2)
      // 注意 name 在 attrExt 里，位置是 offset+16+4，不是 offset+headerSize+4——
      // headerSize 等于 16 时两者巧合相同，但按语义写才对。
      const extStart = offset + 16;
      if (extStart + 20 > xml.length) { offset += size; continue; }
      const nodeName = xml.readUInt32LE(extStart + 4);
      if (nodeName === manifestIdx) {
        const attributeStart = xml.readUInt16LE(extStart + 8);
        const attributeSize = xml.readUInt16LE(extStart + 10);
        const attributeCount = xml.readUInt16LE(extStart + 12);
        const stride = attributeSize >= 20 ? attributeSize : 20;
        // attributeStart 是相对 attrExt 起点的偏移，正常值为 20
        const attrsStart = attributeStart >= 20 ? extStart + attributeStart : extStart + 20;

        let fallback = '';
        for (let i = 0; i < attributeCount && i < 128; i++) {
          const at = attrsStart + i * stride;
          if (at + 20 > xml.length) break;
          const nsIdx = xml.readInt32LE(at);
          const nameIdx = xml.readInt32LE(at + 4);
          if (nameIdx !== packageIdx) continue;

          const rawValue = xml.readInt32LE(at + 8);
          if (rawValue >= 0 && rawValue < strings.length) {
            const value = strings[rawValue];
            if (PACKAGE_PATTERN.test(value)) return value;
            fallback = fallback || value;
          }
          const dataValue = xml.readUInt32LE(at + 16);
          if (dataValue > 0 && dataValue < strings.length) {
            const value = strings[dataValue];
            if (PACKAGE_PATTERN.test(value)) return value;
            fallback = fallback || value;
          }
          if (nsIdx < 0 && rawValue >= 0) break;
        }
        if (fallback && PACKAGE_PATTERN.test(fallback)) return fallback;
      }
    }
    offset += size;
  }
  return '';
}

/**
 * 从字符串池里兜底挑出包名。
 *
 * 只在属性表解析失败时使用。判据必须收紧，否则会误取：
 *   - 权限名    com.xxx.permission.YYY
 *   - 组件类名  com.xxx.SomeActivity（含大写，但包名也可能含大写，不能只靠大小写判断）
 *   - 库声明    org.apache.http.legacy
 *
 * 关键观察：真正的包名在清单里**一定同时出现在若干组件全名的最前面**，
 * 例如包名 com.xj.UsersManager 会有 com.xj.UsersManager.fileprovider 这样的条目。
 * 因此取"被最多其它字符串作为前缀引用的那段"最可靠，
 * 而不是简单地取最短或最长。
 */
function packageFromStringPool(xml) {
  const strings = readStringPool(xml);
  const NON_PACKAGE_PREFIXES = [
    'android.', 'androidx.', 'java.', 'javax.', 'org.apache.', 'org.json.',
    'org.w3c.', 'org.xml.', 'com.google.android.', 'kotlin.', 'dalvik.'
  ];

  const candidates = [];
  for (const s of strings) {
    if (!PACKAGE_PATTERN.test(s)) continue;
    if (NON_PACKAGE_PREFIXES.some((p) => s === p.replace(/\.$/, '') || s.startsWith(p))) continue;
    const segments = s.split('.');
    if (segments.length < 2) continue;
    // 权限与动作常量：整段就是 permission / intent / action 等
    if (segments.some((seg) => /^(permission|intent|action|category|provider|activity|service|receiver)$/i.test(seg))) continue;
    candidates.push(s);
  }
  if (!candidates.length) return '';

  // 统计每个候选被多少条其它字符串当作前缀（组件全名会带上包名做前缀）
  const withScore = candidates.map((candidate) => {
    let referenced = 0;
    for (const s of strings) {
      if (s === candidate) continue;
      if (s.startsWith(`${candidate}.`)) referenced++;
    }
    // 同分时取段数少的（包名通常比组件全名短）
    return { candidate, referenced, segments: candidate.split('.').length };
  });

  withScore.sort((a, b) => {
    if (b.referenced !== a.referenced) return b.referenced - a.referenced;
    if (a.segments !== b.segments) return a.segments - b.segments;
    return a.candidate.length - b.candidate.length;
  });
  return withScore[0].candidate;
}

/** 读单个 APK 的包名。 */
function packageNameFromApk(apkPath) {
  try {
    const buf = fs.readFileSync(apkPath);
    const xml = readZipEntry(buf, 'AndroidManifest.xml');
    if (!xml) return '';
    return packageFromBinaryManifest(xml) || packageFromStringPool(xml);
  } catch (error) {
    return '';
  }
}

/**
 * 读安装包（可能是 .apk / .apks / .apkm / .xapk）的包名。
 *
 * 分包格式本质是 zip 里再放若干 apk，包名在 base.apk 或
 * 第一个 apk 里；这里按 base 优先的顺序逐个尝试。
 */
function packageNameFromFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.apk') return packageNameFromApk(file);

  let outer = null;
  try {
    outer = fs.readFileSync(file);
  } catch (error) {
    return '';
  }

  // 外包里的 apk 列表：解析 central directory 找出所有 .apk 条目
  const names = listZipEntries(outer).filter((n) => /\.apk$/i.test(n));
  if (!names.length) return '';
  names.sort((a, b) => {
    const score = (n) => (/base/i.test(n) ? 0 : /split/i.test(n) ? 2 : 1);
    return score(a) - score(b);
  });

  for (const name of names.slice(0, 4)) {
    const inner = readZipEntry(outer, name);
    if (!inner) continue;
    const xml = readZipEntry(inner, 'AndroidManifest.xml');
    if (!xml) continue;
    const pkg = packageFromBinaryManifest(xml) || packageFromStringPool(xml);
    if (pkg) return pkg;
  }
  return '';
}

/** 列出 zip 中的条目名（供分包查找内部 apk）。 */
function listZipEntries(buffer) {
  const names = [];
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return names;
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

module.exports = {
  PACKAGE_PATTERN,
  readZipEntry,
  readStringPool,
  packageFromBinaryManifest,
  packageFromStringPool,
  packageNameFromApk,
  packageNameFromFile,
  listZipEntries
};
