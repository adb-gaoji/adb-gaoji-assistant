// 校验每套主题下关键文字与背景的对比度，防止出现「白字白底 / 黑字黑底」。
// 需要图形环境，故用 Electron 离屏加载 renderer.html 后实测计算样式。
//
// 退出码：0 全部达标；2 存在低于 WCAG AA（4.5）的项。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// 主题 id → CSS 中实际使用的 data-theme 值
const THEMES = [
  ['graphite', 'dark'], ['indigo', 'indigo'], ['obsidian', 'obsidian'],
  ['light', 'light'], ['sand', 'sand'], ['jade', 'jade']
];

// 需要检查的「文字元素 → 期望对比度」列表
const TARGETS = [
  { selector: '.connection-state strong', name: '连接状态主文字', min: 4.5 },
  { selector: '.connection-state div > span', name: '连接状态副文字', min: 3.0 },
  { selector: '.brand-copy strong', name: '品牌名称', min: 4.5 },
  { selector: '.brand-copy span', name: '品牌副标题', min: 3.0 },
  { selector: '.nav-item:not(.active) span', name: '导航项文字', min: 4.5 },
  { selector: '.nav-item.active span', name: '导航选中项', min: 4.5 }
];

function parseColor(value) {
  const m = String(value).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]) {
  const channel = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.html');
  if (!fs.existsSync(rendererPath)) {
    console.error(`未找到 ${rendererPath}`);
    app.exit(2);
    return;
  }

  const win = new BrowserWindow({
    // 用离屏窗口，不弹到用户桌面上。
    // 离屏窗口不产生合成帧，CSS transition 不会推进的问题，
    // 通过下面的 transition:none 注入彻底规避（见 injectNoTransition）。
    show: false,
    width: 1440, height: 940,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });

  // 禁用全部 CSS 过渡与动画。
  // 这是测量的前提：.nav-item 等元素带 140ms 的 color/background-color 过渡，
  // 在离屏窗口里过渡不会推进，getComputedStyle 会读到过渡起点（上一套主题的颜色），
  // 导致读数在主题之间相互串扰——这正是此前结果时好时坏的根因。
  // 过渡只影响「变化过程」，不影响最终样式，因此禁用后测得的仍是真实对比度。
  const injectNoTransition = `
    (() => {
      const style = document.createElement('style');
      style.id = '__audit_no_transition__';
      style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
      document.head.appendChild(style);
      return 'ok';
    })()
  `;
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(injectNoTransition).catch(() => {});
  });

  await win.loadFile(rendererPath);
  // 等待页面自身初始化完成：renderer.js 会在启动时调用 initializeTheme()，
  // 期间主题属性在不断变动，过早测量会读到中间态。
  await new Promise((r) => setTimeout(r, 2500));

  const failures = [];
  console.log('主题文字对比度检查（WCAG AA 正文 4.5 / 次要文字 3.0）');
  console.log('');

  for (const [id, cssName] of THEMES) {
    // 直接切换 data-theme。过渡已被禁用，切完立刻就是最终样式，无需等待。
    await win.webContents.executeJavaScript(`
      (() => {
        document.documentElement.dataset.theme = ${JSON.stringify(cssName)};
        document.documentElement.dataset.themeTone = ${JSON.stringify(
          ['graphite', 'indigo', 'obsidian'].includes(id) ? 'dark' : 'light'
        )};
        // 兜底：reload 后注入的样式若丢失则补上
        if (!document.getElementById('__audit_no_transition__')) {
          const style = document.createElement('style');
          style.id = '__audit_no_transition__';
          style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
          document.head.appendChild(style);
        }
        return 'ok';
      })()
    `);
    // 让样式重算生效（离屏窗口也可靠，因为不依赖合成帧）
    await new Promise((r) => setTimeout(r, 250));

    // 校验主题确实生效，并读取该主题的 --nav-text 作为交叉验证依据。
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('.nav-item:not(.active)');
        return {
          attr: document.documentElement.getAttribute('data-theme'),
          navTextVar: getComputedStyle(document.documentElement).getPropertyValue('--nav-text').trim(),
          navColor: el ? getComputedStyle(el).color : null,
          transition: el ? getComputedStyle(el).transitionDuration : null
        };
      })()
    `);
    if (state.attr !== cssName) {
      console.log(`  ${id}  ✗ 主题未生效（期望 ${cssName}，实际 ${state.attr}）`);
      failures.push(`${id}：主题属性未生效（实际 ${state.attr}）`);
      continue;
    }

    console.log(`  ${id}`);
    for (const target of TARGETS) {
      const measured = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(target.selector)});
          if (!el) return { missing: true };
          const cs = getComputedStyle(el);
          let node = el, bg = 'rgba(0, 0, 0, 0)';
          while (node) {
            const b = getComputedStyle(node).backgroundColor;
            if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break; }
            node = node.parentElement;
          }
          return { color: cs.color, bg };
        })()
      `);

      if (measured.missing) {
        console.log(`    - ${target.name.padEnd(14)} 元素不存在（跳过）`);
        continue;
      }
      const fg = parseColor(measured.color);
      const bg = parseColor(measured.bg);
      if (!fg || !bg) {
        console.log(`    ? ${target.name.padEnd(14)} 颜色无法解析`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      const ok = ratio >= target.min;
      if (!ok) failures.push(`${id} / ${target.name}：${ratio.toFixed(2)} < ${target.min}`);
      console.log(`    ${ok ? '✓' : '✗'} ${target.name.padEnd(14)} ${ratio.toFixed(2).padStart(6)}  (需 ≥ ${target.min})  文字 ${measured.color}  背景 ${measured.bg}`);

      // 交叉验证：导航项文字必须等于本主题的 --nav-text。
      // 若不等，说明读到的是上一套主题残留的颜色（过渡或时序问题），
      // 此时即使比值达标也不能信任，直接判为失败。
      if (target.selector === '.nav-item:not(.active)' || target.selector === '.nav-item:not(.active) span') {
        const actual = parseColor(measured.color);
        const expected = parseColor(state.navTextVar);
        if (
          actual && expected &&
          (actual[0] !== expected[0] || actual[1] !== expected[1] || actual[2] !== expected[2])
        ) {
          failures.push(
            `${id} / ${target.name}：读到的颜色与 --nav-text(${state.navTextVar}) 不一致，疑似残留值`
          );
          console.log(`      ↑ 与 --nav-text ${state.navTextVar} 不一致，读数不可信`);
        }
      }
    }
    console.log('');
  }

  if (failures.length) {
    console.log(`对比度不足 ${failures.length} 项（P0，必须修复）：`);
    failures.forEach((f) => console.log(`  - ${f}`));
    app.exit(2);
    return;
  }

  console.log(`全部达标：${THEMES.length} 套主题 × ${TARGETS.length} 处文字。`);
  app.exit(0);
}).catch((e) => {
  console.error('对比度检查失败：', e.message);
  app.exit(2);
});
