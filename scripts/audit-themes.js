// 校验 styles.css 中 6 套主题的变量完整性，以及 renderer.js 的 THEMES 是否与之一致。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

const REQUIRED = [
  'bg', 'surface', 'surface-raised', 'surface-subtle',
  'sidebar', 'sidebar-text', 'sidebar-muted', 'sidebar-hover', 'sidebar-active-bg', 'sidebar-active-text',
  'text', 'text-secondary', 'text-muted', 'line', 'line-strong',
  'accent', 'accent-hover', 'accent-soft', 'accent-on',
  'info', 'info-soft', 'danger', 'danger-soft', 'warning', 'warning-soft', 'success', 'success-soft',
  'radius', 'radius-sm', 'shadow', 'shadow-hover'
];

// 从 renderer.js 读取 THEMES 列表
const themeBlock = /const THEMES = \[([\s\S]*?)\n\];/.exec(js);
if (!themeBlock) {
  console.log('未找到 THEMES 定义');
  process.exit(1);
}
const themes = [...themeBlock[1].matchAll(/id:\s*'([a-z]+)'[^}]*label:\s*'([^']+)'/g)]
  .map((m) => ({ id: m[1], label: m[2] }));

console.log(`renderer.js 中定义了 ${themes.length} 套主题`);
console.log('');

let problems = 0;
for (const theme of themes) {
  // graphite 在 CSS 里用 data-theme="dark"；light 的基础变量在裸 :root 中，
  // 需要与 :root[data-theme="light"] 的补充块合并。
  const cssName = theme.id === 'graphite' ? 'dark' : theme.id;
  const re = new RegExp(`:root\\[data-theme="${cssName}"\\]\\s*\\{([\\s\\S]*?)\\n  \\}`);
  const m = re.exec(css);
  if (!m) {
    console.log(`  ✗ ${theme.id.padEnd(10)} ${theme.label}  —— CSS 中未找到 :root[data-theme="${cssName}"]`);
    problems += 1;
    continue;
  }
  let vars = [...m[1].matchAll(/--([a-z-]+)\s*:/g)].map((x) => x[1]);
  if (theme.id === 'light') {
    const base = /:root\s*\{([\s\S]*?)\n  \}/.exec(css);
    if (base) vars = [...new Set([...vars, ...[...base[1].matchAll(/--([a-z-]+)\s*:/g)].map((x) => x[1])])];
  }
  const missing = REQUIRED.filter((r) => !vars.includes(r));
  const status = missing.length ? `缺 ${missing.length}: ${missing.join(', ')}` : '完整';
  if (missing.length) problems += 1;
  console.log(`  ${missing.length ? '✗' : '✓'} ${theme.id.padEnd(10)} ${theme.label.padEnd(6)} ${String(vars.length).padStart(3)} 个变量  ${status}`);
}

console.log('');
console.log(problems === 0 ? '全部主题变量完整 ✓' : `存在 ${problems} 处问题 ✗`);
process.exit(problems === 0 ? 0 : 1);
