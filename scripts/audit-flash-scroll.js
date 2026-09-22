#!/usr/bin/env node
/**
 * 刷机输出区自动滚动审计。
 *
 * 背景：刷机时输出会持续追加，用户要的是「界面固定、内容自己往上滚」。
 * 这依赖两件事同时成立：
 *   1. CSS 给输出区设了 max-height —— 否则内容一多元素就被撑高，
 *      溢出的是整个页面，此时 JS 里设 scrollTop 完全无效，
 *      用户只能自己往下拉（这正是曾经出现过的问题）；
 *   2. JS 在追加后把 scrollTop 跟到底部，并在用户上滚回看时暂停跟随。
 *
 * 只改 CSS 或只改 JS 都会让功能失效，所以放进 CI 一起守住。
 *
 * 退出码：
 *   0  通过
 *   2  失败（属于功能性问题，按 P0 处理）
 *
 * 用法：electron scripts/audit-flash-scroll.js
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

/** 灌入多少行来模拟真实刷机日志。300 行足以让内容远超盒子高度。 */
const BULK_LINES = 300;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1480,
    height: 960,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer.html'));
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const script = `
    (() => {
      const preview = document.getElementById('firmwarePreview');
      const out = {};

      // 输出区必须可见，否则 clientHeight 为 0，布局量不出来
      if (typeof switchPage === 'function') switchPage('firmware');
      resetFlashView(${BULK_LINES}, 'AUDIT-SERIAL');
      bindFlashConsoleScroll();

      const style = getComputedStyle(preview);
      out.maxHeight = style.maxHeight;
      out.overflowY = style.overflowY;

      for (let i = 1; i <= ${BULK_LINES}; i++) {
        appendFlashOutput(
          "[" + i + "/${BULK_LINES}] 刷写分区" + i + "\\n" +
          "      Sending 'part" + i + "' (65536 KB) OKAY [ 1.23s]\\n" +
          "      Writing 'part" + i + "' OKAY [ 0.45s]\\n"
        );
      }

      const atBottom = () => preview.scrollHeight - preview.scrollTop - preview.clientHeight <= 32;
      out.bulk = {
        scrollHeight: preview.scrollHeight,
        clientHeight: preview.clientHeight,
        boxHeight: Math.round(preview.getBoundingClientRect().height),
        innerScrolls: preview.scrollHeight > preview.clientHeight,
        atBottom: atBottom(),
        autoFollow: flashView.autoFollow
      };

      appendFlashOutput("\\n[追加] 新的一行\\n");
      out.afterAppend = { atBottom: atBottom() };

      preview.scrollTop = 0;
      preview.dispatchEvent(new Event('scroll'));
      out.afterScrollUp = { autoFollow: flashView.autoFollow };

      appendFlashOutput("\\n[上滚期间] 不应打断回看\\n");
      out.whileScrolledUp = { stayed: preview.scrollTop < 200, autoFollow: flashView.autoFollow };

      preview.scrollTop = preview.scrollHeight;
      preview.dispatchEvent(new Event('scroll'));
      out.afterScrollBack = { autoFollow: flashView.autoFollow };

      appendFlashOutput("\\n[恢复跟随] 这一行应可见\\n");
      out.afterResume = { atBottom: atBottom() };

      return out;
    })()
  `;

  let result;
  try {
    result = await win.webContents.executeJavaScript(script);
  } catch (error) {
    console.log('刷机输出区自动滚动审计');
    console.log('  FAIL 执行检查脚本失败：' + error.message);
    app.exit(2);
    return;
  }

  const findings = [];
  if (result.maxHeight === 'none') {
    findings.push('输出区没有 max-height —— 内容会把盒子撑高，scrollTop 将失效，用户只能手动下拉');
  }
  if (result.overflowY !== 'auto' && result.overflowY !== 'scroll') {
    findings.push(`输出区 overflow-y 为 ${result.overflowY}，内容无法在盒子内部滚动`);
  }
  if (!result.bulk.innerScrolls) {
    findings.push('灌入大量输出后内容未在盒子内部滚动');
  }
  if (result.bulk.boxHeight > 600) {
    findings.push(`输出区被内容撑高到 ${result.bulk.boxHeight}px，max-height 未生效`);
  }
  if (!result.bulk.atBottom) {
    findings.push('追加输出后未自动跟随到底部（用户需要手动下拉才能看到最新内容）');
  }
  if (!result.afterAppend.atBottom) {
    findings.push('继续追加输出后未保持跟随');
  }
  if (result.afterScrollUp.autoFollow !== false) {
    findings.push('用户上滚回看历史后未暂停跟随');
  }
  if (!result.whileScrolledUp.stayed) {
    findings.push('用户上滚回看期间，新输出把视图强行拽回底部');
  }
  if (result.afterScrollBack.autoFollow !== true) {
    findings.push('用户滚回底部后未恢复自动跟随');
  }
  if (!result.afterResume.atBottom) {
    findings.push('恢复跟随后新输出未贴底');
  }
  findings.push(...consoleErrors);

  console.log('刷机输出区自动滚动审计');
  console.log(`  输出区 max-height : ${result.maxHeight}`);
  console.log(`  overflow-y        : ${result.overflowY}`);
  console.log(`  内容高度 / 可见高度: ${result.bulk.scrollHeight}px / ${result.bulk.clientHeight}px`);
  console.log(`  盒子实际高度      : ${result.bulk.boxHeight}px`);
  console.log(`  自动跟随          : ${result.bulk.autoFollow ? '开' : '关'}`);

  if (!findings.length) {
    console.log('  结果：通过（盒子固定、内容内部滚动、自动跟随，上滚回看不被打断）');
    app.exit(0);
    return;
  }
  console.log(`  结果：发现 ${findings.length} 个问题`);
  for (const item of findings) console.log(`    FAIL ${item}`);
  app.exit(2);
});
