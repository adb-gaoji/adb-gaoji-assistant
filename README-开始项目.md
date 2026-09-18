# ADB搞机助手 V1.1.0（正式版）

Windows 桌面端 Android 维护工具。内置 adb / fastboot / scrcpy 与常用驱动、固件模板，
覆盖设备诊断、Root 与面具、分区提取、固件刷机、应用管理、谷歌三件套、无线投屏和救砖修复。

> 当前版本、最近变更与修复记录见 [`CHANGELOG.md`](CHANGELOG.md)；
> 面向用户的版本升级说明见 [`VERSIONS.md`](VERSIONS.md)（发布时自动用记事本弹出）；
> 开发过程与逐版本验收记录见 [`ROADMAP.md`](ROADMAP.md)。

## 界面风格

内置 6 套界面风格，右上角调色板图标点击循环切换，选择保存在本地、重启后保持：

| 主题 | 名称 | 明暗 | 特点 |
|------|------|------|------|
| `graphite` | 深空石墨 | 深色 | 中性石墨灰 + 薄荷绿，平衡耐看 |
| `indigo` | 午夜靛蓝 | 深色 | 深海军蓝 + 靛蓝，圆角与投影更大 |
| `obsidian` | 曜石霓虹 | 深色 | 纯黑 + 青色，侧栏紫蓝渐变，科技感最强 |
| `light` | 清亮浅色 | 浅色 | 冷灰底 + 绿色强调 |
| `sand` | 暖云米白 | 浅色 | 米白纸面 + 深棕侧栏 + 琥珀点睛 |
| `jade` | 墨玉青瓷 | 浅色 | 低饱和灰绿 + 玉色，圆角最小 |

所有风格共用同一组 CSS 变量，只改取值，布局与功能零改动。新增风格的步骤见
[`design/README.md`](design/README.md)；`design/` 内还提供并排对比页与真实应用截图。

## 环境

- Windows 10/11 x64
- Node.js 24
- Electron 41.2.1
- PowerShell 7（`pwsh`）—— 发布与资源校验脚本建议用 7；脚本已带 UTF-8 BOM，5.1 也可运行

## 开发

```powershell
npm install
npm run check     # 语法检查（node --check 全部源文件）
npm test          # 语法检查 + 54 项单元/契约测试
npm run ci        # 完整 CI：语法 → 测试 → 依赖审计 → 7 项审计 → 资源校验
npm start         # 启动应用
```

## 测试与审计

除单元测试外，项目带一组**后台审计脚本**，不启动 Electron 窗口即可校验契约，
用于防止界面、主进程与处理器之间出现判定漂移：

```powershell
npm run audit:actions          # 动作清单：ACTION_IDS 与 handlers、界面注册是否一致
npm run audit:danger           # 危险动作：主进程门禁与界面二次确认是否对齐
npm run audit:tasks            # 任务中心状态流转
npm run audit:ui-state         # 界面状态、筛选与滚动契约
npm run audit:wireless-cast    # 无线投屏参数与设备绑定
npm run audit:wireless-pair    # 无线 ADB 配对端口与顺序
npm run audit:mirror-session   # 投屏会话生命周期
```

审计脚本用退出码表达严重度：`2` = 存在 P0 必须修，`1` = 存在已在
`ROADMAP.md` 登记的 P1 缺口，`0` = 通过。`npm run ci` 只在出现 P0 时失败，
P1 缺口以警告形式列出。

### 纯函数模块与回归测试

解析类逻辑已从 `main.js` 抽到独立模块，不依赖 Electron，可直接单元测试：

| 模块 | 内容 |
|---|---|
| `src/firmware_parser.js` | 固件 XML 解析、命令生成、XML 挑选 |
| `src/adb_parser.js` | `adb devices -l` / `fastboot devices -l` 输出解析 |
| `src/actions.registry.js` | 动作元数据（危险/安装/前置条件/二次确认） |

`tests/v1.0.0-regression.test.js` 专门覆盖已经实际出过问题的边界：
`shellArg` 引号转义、`parseFirmwareXml` 的 `<step>` 解析与 `erase` 严格 opt-in、
`parseAdbDevices` 的 detail 完整性、无线地址校验。改动这些函数会让测试立刻失败。

## 打包与发布

```powershell
npm run dist                   # 仅打包 → dist\ADB搞机助手_V<版本>_安装包.exe
npm run release:install        # CI → 打包 → 归档桌面 → 覆盖安装 → 单实例验证 → git 提交打 tag
```

`scripts/release.ps1` 可加开关跳过环节：

| 开关 | 作用 |
|---|---|
| `-SkipCi` | 只跑单元测试，跳过完整 CI |
| `-SkipBuild` | 复用 `dist/` 已有产物，不重新打包 |
| `-SkipInstall` | 只出包，不动本机已安装版本 |
| `-SkipVerify` | 跳过安装后的单窗口启动验证 |
| `-NoGit` | 跳过提交与打 tag |
| `-NoNotes` | 不弹出记事本展示版本升级说明 |

> **重要**：`electron-builder` 每次构建都会清空 `dist/`。
> 发布脚本会在打包**之前**先把既有安装包抢救到桌面归档目录，
> 因此不要绕过脚本直接调用 `npx electron-builder`，否则历史安装包会丢失。

## 目录结构

```
src/
  main.js                 主进程：窗口、IPC、过程执行、动作分发
  action_handlers.js      动作处理器（110 个动作）
  actions.registry.js     动作元数据唯一来源（危险/安装/Fastboot/ADB 所需）
  firmware_parser.js      固件 XML 解析与 fastboot 命令生成（纯函数，可测）
  adb_parser.js           adb / fastboot 设备列表解析（纯函数，可测）
  renderer.js  renderer.html  styles.css    渲染进程界面
  preload.js              contextBridge 暴露 window.gaoji
  app_package_query.js    应用列表查询（内置 helper APK）
  device_reboot.js        重启动作
  firmware-catalog.js     固件下载目录
scripts/
  ci.ps1                  完整 CI（语法/测试/依赖审计/7 项审计/资源校验）
  release.ps1             发布流程（CI → 打包 → 归档 → 安装 → 验证 → 提交）
  verify-resources.ps1    关键资源完整性校验
  audit-*.js              7 项契约审计
tests/                    单元与契约测试（54 项）
resources/                运行时资源（见下）
```

## resources 与体积说明

`resources/` 存放随包分发的大体积二进制资源，**合计约 894 MB，不纳入版本控制**。
其中 Tea 模板的 A/B 槽位镜像内容完全相同，已合并为单份（释放 480 MB）。

```powershell
pwsh -File scripts/verify-resources.ps1    # 校验关键资源是否齐全
```

克隆仓库后必须补齐该目录，否则对应功能与打包会缺文件。
完整清单、用途与 SHA256 校验值见 [`resources/MANIFEST.md`](resources/MANIFEST.md)。

## 安全边界

- 涉及设备写入的功能（刷机、解锁、清数据、写分区）**必须人工核对**机型、系统版本、
  槽位与备份，并经过界面二次确认。
- 固件刷机中的 `erase`（清除数据）步骤默认**跳过**，只有显式选择完整刷机入口才执行。
- 固件刷机绑定目标序列号，连接多台 Fastboot 设备时不会刷错机器。
- 自动化测试只做静态契约与 mock 校验，**不执行**真实刷机、解锁、分区写入、恢复出厂
  或不可恢复的数据删除。
