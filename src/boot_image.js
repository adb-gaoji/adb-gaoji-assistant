/**
 * Android boot 镜像的解析与重打包（header v0-v4）。
 *
 * 背景：Tea 移植的正确做法是"保留原机 boot 的 kernel/header/签名块，
 * 只替换 ramdisk 里的 Tea 相关文件"。这要求能原样读出一张 boot 的
 * 各段结构，改掉 ramdisk 后再按同样的布局拼回去。
 *
 * 关键约束——重打包时**必须保持**：
 *   · kernel 原样不动（它决定了能不能开机）；
 *   · header 里除 ramdisk_size 外的所有字段（cmdline/addr/os_version）；
 *   · signature 段（AVB 签名块）原样保留；
 *   · 页对齐规则与原始一致，否则 bootloader 读不到 ramdisk。
 *
 * v4 的布局（AOSP bootimg.h）：
 *   header(header_size) + signature_size(4) + signature(signature_size)
 *   之后 kernel、ramdisk、second 依次按 4096 对齐排布。
 * v0-v2 的布局不同：header 固定 1632 字节，各段按 page_size 对齐。
 */

const MAGIC = 'ANDROID!';
/** boot v4 的页对齐固定为 4096（不再取 header 里的 page_size）。 */
const V4_ALIGN = 4096;

/** 图像结构识别失败时抛出，调用方负责转成用户可读的错误。 */
class BootImageError extends Error {}

function alignTo(value, alignment) {
  if (alignment <= 1) return value;
  return Math.ceil(value / alignment) * alignment;
}

/**
 * 解析 boot 镜像头，返回各段的偏移与长度。
 *
 * 不做任何"猜测式"解析：读不到 magic 直接报错，
 * 因为把非 boot 文件当 boot 处理会产生一个看似正常的坏镜像。
 */
function parse(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 8) !== MAGIC) {
    throw new BootImageError('不是有效的 Android boot 镜像（缺少 ANDROID! 魔数）。');
  }

  const kernelSize = buf.readUInt32LE(8);
  const ramdiskSize = buf.readUInt32LE(12);
  const osVersion = buf.readUInt32LE(16);
  const headerSize = buf.readUInt32LE(20);
  const headerVersion = buf.readUInt32LE(40);

  if (!kernelSize) throw new BootImageError('boot 镜像头里 kernel 大小为 0，文件可能已损坏。');

  let signatureSize = 0;
  let ramdiskOffset;
  let pageSize = 0;

  if (headerVersion >= 3) {
    // v3/v4：header + signature，之后按 4096 对齐
    if (headerSize + 4 > buf.length) throw new BootImageError('boot 镜像头长度异常。');
    signatureSize = buf.readUInt32LE(headerSize);
    ramdiskOffset = alignTo(headerSize + 4 + signatureSize, V4_ALIGN);
    ramdiskOffset = alignTo(ramdiskOffset + kernelSize, V4_ALIGN);
  } else {
    // v0-v2：page_size 决定对齐
    pageSize = buf.readUInt32LE(36) || 2048;
    const secondSize = buf.readUInt32LE(24);
    ramdiskOffset = alignTo(headerSize, pageSize) + alignTo(kernelSize, pageSize) + alignTo(secondSize, pageSize);
  }

  if (ramdiskOffset + ramdiskSize > buf.length) {
    throw new BootImageError('boot 镜像不完整：ramdisk 段超出文件范围。');
  }

  return {
    headerVersion,
    headerSize,
    kernelSize,
    ramdiskSize,
    ramdiskOffset,
    signatureSize,
    pageSize,
    osVersion,
    header: buf.slice(0, headerSize + 4 + signatureSize),
    kernel: buf.slice(alignTo(headerVersion >= 3 ? headerSize + 4 + signatureSize : headerSize, headerVersion >= 3 ? V4_ALIGN : pageSize),
      alignTo(headerVersion >= 3 ? headerSize + 4 + signatureSize : headerSize, headerVersion >= 3 ? V4_ALIGN : pageSize) + kernelSize),
    ramdisk: buf.slice(ramdiskOffset, ramdiskOffset + ramdiskSize)
  };
}

/**
 * 用新的 ramdisk 重新打包 boot 镜像。
 *
 * header 段整体复用（含签名块），只把 ramdisk_size 改掉。
 * 这样最大程度保留原厂信息——尤其是 AVB 签名块和 cmdline，
 * 改动越少，开机成功率越高。
 */
function repack(parsed, newRamdisk) {
  const { header, kernel, headerVersion, headerSize, pageSize } = parsed;
  const align = headerVersion >= 3 ? V4_ALIGN : pageSize;

  const outHeader = Buffer.from(header);
  outHeader.writeUInt32LE(newRamdisk.length, 12);

  const parts = [outHeader];
  const pad1 = alignTo(outHeader.length, align) - outHeader.length;
  if (pad1 > 0) parts.push(Buffer.alloc(pad1));
  parts.push(kernel);

  const pad2 = alignTo(kernel.length, align) - kernel.length;
  if (pad2 > 0) parts.push(Buffer.alloc(pad2));
  parts.push(newRamdisk);

  return Buffer.concat(parts);
}

/** 从 boot 镜像里取出解压后的 ramdisk（自动识别 gzip / LZ4 / 裸 cpio）。 */
function detectRamdiskCompression(ramdisk) {
  if (ramdisk.length >= 2 && ramdisk[0] === 0x1f && ramdisk[1] === 0x8b) return 'gzip';
  if (ramdisk.length >= 4 && ramdisk.readUInt32LE(0) === 0x184C2102) return 'lz4-legacy';
  if (ramdisk.length >= 4 && ramdisk.readUInt32LE(0) === 0x184D2204) return 'lz4-frame';
  if (ramdisk.length >= 6 && ramdisk.toString('ascii', 0, 6) === '070701') return 'cpio';
  return 'unknown';
}

module.exports = { parse, repack, detectRamdiskCompression, BootImageError, V4_ALIGN, MAGIC };
