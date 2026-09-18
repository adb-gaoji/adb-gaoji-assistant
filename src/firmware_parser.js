/**
 * 固件刷机包的 XML 解析与命令生成。
 *
 * 本模块只依赖 Node 内置模块，不触碰 Electron API，
 * 因此可以脱离 Electron 直接进行单元测试。
 *
 * 支持 Motorola / Lenovo 官方刷机包的 `flashfile.xml` 与 `servicefile.xml` 结构：
 *   <flashing>
 *     <header>…</header>
 *     <steps interface="AP">
 *       <step operation="flash" partition="boot" filename="boot.img"/>
 *       …
 *     </steps>
 *   </flashing>
 * 注意命令全部挂在 `<step>` 节点上，解析时**不得**跳过该标签。
 */
const fs = require('fs');
const path = require('path');

/** XML 优先级：servicefile（完整服务刷机）> flashfile（常规刷机）> 含 cfc 的脚本 > 其它 */
const XML_PRIORITY = (file) => {
  const name = path.basename(file).toLowerCase();
  if (name === 'servicefile.xml') return 0;
  if (name === 'flashfile.xml') return 1;
  if (name.includes('cfc')) return 2;
  return 9;
};

/** 递归列出目录下全部 XML 文件。 */
function listFirmwareXml(rootDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) found.push(full);
    }
  };
  walk(rootDir);
  return found;
}

/**
 * 按模式挑选要使用的 XML。
 * @param {string} rootDir 固件根目录
 * @param {'auto'|'service'|'flash'|'cfc'} mode 选择模式
 */
function findFirmwareXml(rootDir, mode = 'auto') {
  const found = listFirmwareXml(rootDir);
  if (mode === 'service') return found.find((file) => path.basename(file).toLowerCase() === 'servicefile.xml') || '';
  if (mode === 'flash') return found.find((file) => path.basename(file).toLowerCase() === 'flashfile.xml') || '';
  if (mode === 'cfc') return found.find((file) => path.basename(file).toLowerCase().includes('cfc')) || '';
  found.sort((a, b) => XML_PRIORITY(a) - XML_PRIORITY(b) || a.localeCompare(b));
  return found[0] || '';
}

/** 提取标签属性，统一小写键名，支持单双引号。 */
function parseXmlAttributes(text) {
  const attrs = {};
  const pattern = /([:\w-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  let match;
  while ((match = pattern.exec(text))) attrs[match[1].toLowerCase()] = match[2].slice(1, -1);
  return attrs;
}

/**
 * 解析固件 XML 并生成 fastboot 命令序列。
 *
 * @param {string} xmlPath XML 路径
 * @param {boolean} allowErase 是否允许执行 erase（清除数据）。
 *   必须是严格的 `true`：`1`、`'true'` 等真值一律按未允许处理，
 *   因为这些值通常来自表单或 JSON，误判会直接清除用户数据。
 * @returns {{folder: string, xmlPath: string, commands: Array, skipped: string[]}}
 * @throws {Error} 未解析到任何可执行命令时抛出。
 */
function parseFirmwareXml(xmlPath, allowErase = false) {
  const eraseAllowed = allowErase === true;
  const folder = path.dirname(xmlPath);
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const commands = [];
  const skipped = [];
  const nodePattern = /<([A-Za-z0-9_:.-]+)\b([^>]*?)(?:\/?>)/g;
  let match;
  while ((match = nodePattern.exec(xml))) {
    const tag = match[1].toLowerCase();
    // 跳过声明、注释、容器节点与稀疏镜像分片声明。
    // 注意：`step` 是承载命令的节点，绝不能跳过。
    if (tag.startsWith('?') || tag.startsWith('!') || tag === 'steps' || tag.endsWith('sparsing')) continue;
    const attrs = parseXmlAttributes(match[2]);
    const op = String(attrs.operation || attrs.op || tag).toLowerCase();
    const partition = attrs.partition || attrs.var || attrs.arg || '';
    const filename = attrs.filename || attrs.file || attrs.sparsechunk || '';
    if (op === 'flash' && partition && filename) {
      const filePath = path.resolve(folder, filename);
      commands.push({ args: ['flash', partition, filePath], label: `flash ${partition} ${filename}`, file: filePath });
    } else if (op === 'erase' && partition) {
      if (eraseAllowed) commands.push({ args: ['erase', partition], label: `erase ${partition}` });
      else skipped.push(`erase ${partition}（未允许清除数据）`);
    } else if (op === 'getvar') {
      commands.push({ args: ['getvar', partition || 'all'], label: `getvar ${partition || 'all'}` });
    } else if (op === 'reboot-bootloader' || op === 'reboot_bootloader') {
      commands.push({ args: ['reboot-bootloader'], label: 'reboot-bootloader' });
    } else if (op === 'reboot' || op === 'continue') {
      const target = attrs.target || '';
      const args = op === 'continue' ? ['continue'] : ['reboot', ...(target ? [target] : [])];
      commands.push({ args, label: args.join(' ') });
    } else if (op === 'set_active' || op === 'set-active' || op === 'fbsetactive') {
      const slot = (attrs.slot || attrs.arg || attrs.value || '').replace(/^_/, '');
      if (slot) commands.push({ args: [`--set-active=${slot}`], label: `--set-active=${slot}` });
    } else if (op === 'oem') {
      const value = attrs.value || attrs.arg || partition;
      if (value) commands.push({ args: ['oem', ...value.split(/\s+/)], label: `oem ${value}` });
    } else if (['flash', 'erase', 'oem', 'getvar', 'reboot', 'continue', 'set_active'].includes(op)) {
      skipped.push(`无法解析：${tag}`);
    }
  }
  if (!commands.length) throw new Error('XML 中没有解析到可执行的 Fastboot 命令。');
  return { folder, xmlPath, commands, skipped };
}

/** 生成给人看的命令预览报告。 */
function firmwareReport(parsed) {
  const flash = parsed.commands.filter((command) => command.args[0] === 'flash');
  const erase = parsed.commands.filter((command) => command.args[0] === 'erase');
  const missing = flash.filter((command) => !fs.existsSync(command.file));
  const partitions = [...new Set(flash.map((command) => command.args[1]))];
  const commandLines = parsed.commands.map((command, index) => `${String(index + 1).padStart(2, '0')}. fastboot ${command.label}`);
  return [
    `XML：${parsed.xmlPath}`,
    `可执行命令：${parsed.commands.length} 条`,
    `刷入分区：${partitions.join('、') || '未识别'}`,
    `清除命令：${erase.length} 条（当前未允许时会跳过）`,
    `缺失镜像：${missing.length} 个`,
    parsed.skipped.length ? `跳过项：${parsed.skipped.join('；')}` : '跳过项：无',
    '',
    'Fastboot 命令预览：',
    ...commandLines
  ].join('\n');
}

module.exports = {
  listFirmwareXml,
  findFirmwareXml,
  parseXmlAttributes,
  parseFirmwareXml,
  firmwareReport
};
