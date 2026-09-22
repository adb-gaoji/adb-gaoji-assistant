/**
 * CPIO (newc) 归档的解析与生成。
 *
 * Android ramdisk 用的就是 newc 格式（magic 070701/070702）。
 * 需要它是因为 Tea 移植本质是把 donor 的若干文件塞进原厂 ramdisk：
 *   .backup/.tea / overlay.d/sbin/tea32.xz / tea64.xz / teapolicy.xz
 *   / tea.product / tea.product.bak
 * 每个条目的头是 110 字节 ASCII 十六进制字段，之后名字 + 4 字节对齐，
 * 再之后文件内容 + 4 字节对齐，最后以 TRAILER!!! 收尾。
 */

const MAGIC_NEWC = '070701';
const MAGIC_CRC = '070702';
const HEADER_SIZE = 110;
const TRAILER = 'TRAILER!!!';

const align4 = (n) => (n + 3) & ~3;

/** 解析 cpio，返回条目列表（含在缓冲区中的偏移与长度）。 */
function parse(buf) {
  const entries = [];
  let off = 0;
  while (off + HEADER_SIZE <= buf.length) {
    const magic = buf.toString('ascii', off, off + 6);
    if (magic !== MAGIC_NEWC && magic !== MAGIC_CRC) break;
    const field = (o) => parseInt(buf.toString('ascii', off + o, off + o + 8), 16) || 0;
    // mode 决定条目类型（普通文件/目录/符号链接）——制作 boot 时必须原样保留，
    // 否则把符号链接写成普通文件会让 magiskinit 找不到真正的 init。
    const mode = field(14);
    const filesize = field(54);
    const namesize = field(94);
    if (namesize <= 0 || off + HEADER_SIZE + namesize > buf.length) break;
    const name = buf.toString('utf8', off + HEADER_SIZE, off + HEADER_SIZE + namesize - 1);
    if (name === TRAILER) break;
    const dataStart = off + align4(HEADER_SIZE + namesize);
    if (dataStart + filesize > buf.length) break;
    entries.push({
      name,
      mode,
      size: filesize,
      data: buf.slice(dataStart, dataStart + filesize)
    });
    off = dataStart + align4(filesize);
  }
  return entries;
}

/** 八位十六进制（cpio 头字段一律 8 位）。 */
function hex8(value) {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** 生成一个条目的头 + 内容。 */
function encodeEntry(entry) {
  const nameBuf = Buffer.from(`${entry.name}\0`, 'utf8');
  const data = entry.data || Buffer.alloc(0);
  // 字段顺序固定：magic 之后依次 ino/mode/uid/gid/nlink/mtime/filesize/devmajor/devminor/rdevmajor/rdevminor/namesize/check
  const header = MAGIC_NEWC +
    hex8(entry.ino || 0) + hex8(entry.mode || 0o100644) +
    hex8(entry.uid || 0) + hex8(entry.gid || 0) +
    hex8(entry.nlink || 1) + hex8(entry.mtime || 0) +
    hex8(data.length) +
    hex8(entry.devmajor || 0) + hex8(entry.devminor || 0) +
    hex8(entry.rdevmajor || 0) + hex8(entry.rdevminor || 0) +
    hex8(nameBuf.length) + hex8(0);
  const headerBuf = Buffer.from(header, 'ascii');
  const pad1 = Buffer.alloc(align4(HEADER_SIZE + nameBuf.length) - (HEADER_SIZE + nameBuf.length));
  const pad2 = Buffer.alloc(align4(data.length) - data.length);
  return Buffer.concat([headerBuf, nameBuf, pad1, data, pad2]);
}

/** 把条目列表打包成完整的 newc 归档。 */
function build(entries) {
  const parts = entries.map(encodeEntry);
  // 结尾的 TRAILER 条目：只有头和名字，没有内容。
  parts.push(encodeEntry({ name: TRAILER, mode: 0, data: Buffer.alloc(0) }));
  const body = Buffer.concat(parts);
  // 归档整体再做一次 4 字节对齐，部分内核解包器对此敏感。
  const tail = Buffer.alloc(align4(body.length) - body.length);
  return Buffer.concat([body, tail]);
}

module.exports = { parse, build, encodeEntry, align4, MAGIC_NEWC, TRAILER };
