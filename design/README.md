# 界面风格方案

ADB搞机助手 V1.1.0 起提供 6 种界面风格，右上角调色板图标点击循环切换，
选择结果保存在 `localStorage.theme`，重启后保持。

## 快速对比

用浏览器直接打开 `design/theme-picker.html`（可点顶部按钮单独查看某一套）。
`design/app/*.png` 是**真实应用**在每种主题下的截图。

## 方案一览

| # | 主题 id | 名称 | 明暗 | 特点 |
|---|---------|------|------|------|
| 1 | `graphite` | 深空石墨 | 深色 | 原有深色。中性石墨灰 + 薄荷绿，平衡耐看，长时间不刺眼 |
| 2 | `indigo` | 午夜靛蓝 | 深色 | 深海军蓝 + 靛蓝，圆角/投影更大，最"贵"的一套深色 |
| 3 | `obsidian` | 曜石霓虹 | 深色 | 纯黑 + 青色，侧栏紫蓝渐变，圆角最大，科技感最强 |
| 4 | `light` | 清亮浅色 | 浅色 | 原有浅色。冷灰底 + 绿色强调 |
| 5 | `sand` | 暖云米白 | 浅色 | 米白纸面 + 深棕侧栏 + 琥珀点睛，纸质感强 |
| 6 | `jade` | 墨玉青瓷 | 浅色 | 低饱和灰绿 + 玉色，圆角最小，安静稳重 |

## 实现方式

所有风格共用**同一组 CSS 变量**，只改取值，布局与功能零改动：

```css
:root { /* 默认浅色 */ }
:root[data-theme="dark"]      { /* 深空石墨 */ }
:root[data-theme="indigo"]    { /* 午夜靛蓝 */ }
:root[data-theme="obsidian"]  { /* 曜石霓虹 */ }
:root[data-theme="sand"]      { /* 暖云米白 */ }
:root[data-theme="jade"]      { /* 墨玉青瓷 */ }
```

变量接口：

| 变量 | 用途 |
|------|------|
| `--bg` / `--surface` / `--surface-raised` / `--surface-subtle` | 页面与卡片底色层级 |
| `--sidebar` / `--sidebar-text` / `--sidebar-muted` / `--sidebar-hover` | 侧栏文字与悬停 |
| `--sidebar-active-bg` / `--sidebar-active-text` | 侧栏选中项（可放渐变） |
| `--text` / `--text-secondary` / `--text-muted` | 三级文字 |
| `--line` / `--line-strong` | 分隔线与边框 |
| `--accent` / `--accent-hover` / `--accent-soft` / `--accent-on` | 主强调色及其前景色 |
| `--info` / `--danger` / `--warning` / `--success`（含 `-soft`） | 语义色 |
| `--radius` / `--radius-sm` | 圆角 |
| `--shadow` / `--shadow-hover` | 阴影 |
| `--hero-bg` / `--hero-line` | 设备主卡片（可渐变） |

## 相关文件

- `src/styles.css` — 6 套主题变量定义
- `src/renderer.js` — `THEMES` 列表、`applyTheme()`、`cycleTheme()`
- `design/theme-preview.html` — 静态对比页（并排看 5 套）
- `design/theme-picker.html` — 可切换的对比页
- `design/app/*.png` — 真实应用截图

## 新增一套风格

1. 在 `src/styles.css` 按上表补齐变量块 `:root[data-theme="yourid"] { … }`
2. 在 `src/renderer.js` 的 `THEMES` 数组加一项 `{ id, label, icon, legacy }`
   （`legacy` 为 `dark` 或 `light`，用于原生控件配色判断）
3. 完成，切换按钮会自动包含新主题。图标名取自 Phosphor 图标集。
