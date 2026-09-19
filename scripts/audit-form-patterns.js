#!/usr/bin/env node
/**
 * 表单 pattern 合法性审计。
 *
 * 背景：`ACTION_FORMS` 里每个字段的 `pattern` 会成为 HTML `<input pattern="...">`，
 * 而 Chromium 按 **v 模式**（unicodeSets）编译它。v 模式比传统正则严格得多，
 * 例如字符类里的 `\-` 是非法转义：
 *
 *   /[A-Za-z0-9_\-]+/v  ->  SyntaxError: Invalid character in character class
 *
 * 后果不是抛异常，而是**该 pattern 被整个忽略**——表单校验静默失效，
 * 用户能提交任意字符串，只在控制台留下一行 console 错误。
 * 这种"看起来有校验、实际没有"的失效最难发现，因此放进 CI 挡住。
 *
 * 退出码：
 *   0  全部合法
 *   2  存在非法 pattern（按 P0 处理，因为它会让校验静默失效）
 *
 * 用法：node scripts/audit-form-patterns.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src', 'renderer.js');
const source = fs.readFileSync(rendererPath, 'utf8');

function lineOf(index) {
  return source.slice(0, index).split('\n').length;
}

const findings = [];
const patterns = [];

/**
 * 把源码里的字符串字面量按 JS 转义规则解码成运行时真正持有的字符串。
 *
 * 这一步不能省：源码里写 `pattern: '[A-Za-z0-9_\\x2d]+'`，
 * 运行时 `input.pattern` 拿到的是 `[A-Za-z0-9_\x2d]+`（单反斜杠）。
 * 如果直接把源码字面量丢给 `new RegExp`，编译的是 `\\x2d`（字面反斜杠 + x2d），
 * 验证的就不是浏览器实际使用的那条正则——会漏掉真实错误。
 */
function decodeJsString(literal) {
  let out = '';
  for (let i = 0; i < literal.length; i++) {
    const ch = literal[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = literal[i + 1];
    i++;
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case 'x': {
        const hex = literal.slice(i + 1, i + 3);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      case 'u': {
        if (literal[i + 1] === '{') {
          const end = literal.indexOf('}', i);
          out += String.fromCodePoint(parseInt(literal.slice(i + 2, end), 16));
          i = end;
        } else {
          const hex = literal.slice(i + 1, i + 5);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        }
        break;
      }
      default: out += next; break;
    }
  }
  return out;
}

for (const match of source.matchAll(/pattern:\s*'((?:[^'\\]|\\.)*)'/g)) {
  const runtime = decodeJsString(match[1]);
  const line = lineOf(match.index);
  patterns.push({ raw: match[1], runtime, line });

  // 1) 用 v 模式（与 Chromium 一致）编译**运行时字符串**，能直接问出真话
  let compileError = '';
  try {
    // eslint-disable-next-line no-new
    new RegExp(runtime, 'v');
  } catch (error) {
    compileError = error.message;
  }
  if (compileError) {
    findings.push(`${line} 行：pattern 在 v 模式下非法 -> ${runtime}\n        原因：${compileError}`);
    continue;
  }

  // 2) 与 HTML 属性一致：换行、引号会截断属性值
  if (/["'\n\r]/.test(runtime)) {
    findings.push(`${line} 行：pattern 含引号或换行，写入 HTML 属性会被截断 -> ${runtime}`);
  }
}

console.log('表单 pattern 审计');
console.log(`  检查文件：src/renderer.js`);
console.log(`  发现 pattern：${patterns.length} 个`);

// 顺带回显一处已知安全的写法，便于确认解析没有落空
if (!patterns.length) {
  console.log('  结果：未解析到任何 pattern，请确认 ACTION_FORMS 结构是否变化');
  process.exit(2);
}

if (!findings.length) {
  console.log('  结果：全部合法');
  process.exit(0);
}

console.log(`  结果：发现 ${findings.length} 个问题`);
for (const item of findings) console.log(`    FAIL ${item}`);
process.exit(2);
