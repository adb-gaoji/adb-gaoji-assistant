<div align="center">

# ADB搞机助手

**Windows 桌面端 Android 维护工具箱**

内置 adb / fastboot / scrcpy 与常用驱动、固件模板。**专治国产 ROM 上
谷歌三件套装了不能用**——闪退、停用、重启失效一条流程修完；
另覆盖设备诊断、Root 与面具、分区提取、固件刷机、应用管理、无线投屏与救砖修复。

[![Version](https://img.shields.io/badge/version-1.1.0-blue?style=flat-square)](VERSIONS.md)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d4?style=flat-square)](#环境要求)
[![Electron](https://img.shields.io/badge/Electron-41.2.1-47848f?style=flat-square&logo=electron&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white)](#环境要求)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-55%20passed-brightgreen?style=flat-square)](#测试与质量保障)
[![CI](https://img.shields.io/badge/CI-14%20checks-brightgreen?style=flat-square)](#测试与质量保障)

[⭐ 谷歌三件套修复](#-主打功能谷歌三件套修复) · [为什么用它](#为什么用它) ·
[一起做得更好](#一起把它做得更好) · [功能特性](#功能特性) · [界面风格](#界面风格) ·
[快速开始](#快速开始) · [架构说明](#架构说明) · [参与贡献](CONTRIBUTING.md) · [更新日志](CHANGELOG.md)

</div>

---

## 这是什么

一个把 Android 刷机、救砖、清理、投屏这些高频操作集中到图形界面的桌面工具。
不需要记 `fastboot flash` 的参数，也不用在多个工具之间来回切换。

它把常用的 adb / fastboot / scrcpy 和驱动、固件模板一起打包，装完即用。
所有操作都走界面二次确认，涉及写分区的功能会绑定目标设备序列号，
**连接多台设备时不会刷错机器**。

> **本项目仅支持 Windows 10/11 x64。** 所有设备操作都需要你自行确认机型与
> 系统版本的匹配性，详见[安全边界](#安全边界)。

## ⭐ 主打功能：谷歌三件套修复

> **国产 ROM 装上谷歌服务后最常见的三个毛病——点了闪退、用了就停、重启就失效——
> 这个工具是专门为它们做的。**

很多国产系统（摩托罗拉国行、联想、部分定制 ROM）自带谷歌服务开关但默认关闭，
手动装上 GSF / Play 服务 / Play 商店之后往往仍然用不了。原因通常不是「包装错了」，
而是**组件被系统冻结、后台策略被限制、或缺少开机自启的放行规则**。

这个工具的「Google 服务修复中心」把整条链路做成了可点按钮：

| 你遇到的现象 | 对应功能 | 实际做了什么 |
|---|---|---|
| 不知道装没装、装的对不对 | **深度诊断环境** | 逐个读取 GSF / Play 服务 / Play 商店的安装状态、启用状态、版本号与版本代码，并带上系统版本、SDK、CPU ABI，导出一份完整报告 |
| 装完打不开、一点就闪退 | **一键安装 / 更新** | 按 **GSF → Play 服务 → Play 商店** 的正确顺序安装内置包，顺序由文件名智能排序，不需要自己判断先装哪个 |
| Play 服务反复「已停止运行」 | **修复 Play 服务停止** | 重新启用三个组件 + `install-existing` 恢复被卸载的系统包 + 加入 Doze 白名单 + 放行 `RUN_IN_BACKGROUND` / `RUN_ANY_IN_BACKGROUND` 两条后台策略，最后清理主用户数据 |
| 重启之后又失效了 | **修复重启后失效** | 在上一套放行基础上，把放行规则写进 Magisk 的 `service.d` 开机脚本（`99_adb_gaoji_gms.sh`），每次开机自动重新放行；无 Root 时自动降级为仅运行时放行，并明确告诉你降级了 |
| 某个应用（游戏 / 银行 / 地图）提示需要谷歌服务 | **修复应用运行** | 把目标应用和三个谷歌组件一起加入放行名单，强制停止后重新拉起 |
| 系统里有开关但找不到入口 | **打开谷歌服务开关** | 依次尝试摩托罗拉国行的 `GoogleSwitchActivity`、GSF 应用详情页、系统设置搜索页，命中哪个用哪个 |
| 内置包版本太旧不合适 | **导入本地三件套** / **打开最新版下载** | 可以导入自己的 APK/APKS 走同一套流程；也可以直接打开三个组件的 APKMirror 官方分类页取最新版 |
| 想彻底恢复干净 | **卸载谷歌三件套** | 从主用户（`--user 0`）卸载三个组件，带二次确认 |

**和「装个谷歌安装器」的区别**：安装器只管把包推进去，装完能不能用要看系统给不给后台权限。
这里把**安装、放行、白名单、开机自启、诊断**串成一条流程，并且每一步的原始输出都打进日志。

<details>
<summary><b>点开看具体执行了哪些命令</b></summary>

放行一个组件时，会依次执行这五条：

```bash
pm enable --user 0 <包名>                                    # 解除冻结
cmd package install-existing --user 0 <包名>                 # 恢复被卸掉的系统包
cmd deviceidle whitelist +<包名>                             # 加入 Doze 省电白名单
cmd appops set --user 0 <包名> RUN_IN_BACKGROUND allow       # 允许后台运行
cmd appops set --user 0 <包名> RUN_ANY_IN_BACKGROUND allow   # 允许任意后台运行
```

三个组件的包名：

| 组件 | 包名 |
|---|---|
| Google 服务框架（GSF） | `com.google.android.gsf` |
| Google Play 服务 | `com.google.android.gms` |
| Google Play 商店 | `com.android.vending` |

「修复重启后失效」额外做的事：把上面 `pm enable` 与 `cmd deviceidle whitelist`
两行写成 shell 脚本，push 到 `/data/local/tmp/`，再用 `su` 复制到
`/data/adb/service.d/99_adb_gaoji_gms.sh` 并 `chmod 755`——Magisk 会在每次开机时执行它。

**没有 Root 也能用**：`su` 失败时不会中断，会明确返回
「当前无 Root 或 service.d 不可写，仅完成运行时放行」，你一眼就知道持久化那步没成。

</details>

> **注意**：清理主用户数据意味着 **Google 账号需要重新登录**；
> 「修复 Play 服务停止」与「修复重启后失效」都包含这一步，执行前有二次确认。

---

## 为什么用它

同类工具不少，下面这些是**能自己动手核实**的差异点，不是宣传语。

### 一、装完即用，不联网

`adb`、`fastboot`、`scrcpy 4.0`、安卓 USB 驱动、VC++ 运行时、Magisk、
固件模板、谷歌三件套安装包——**893.7 MB 的运行时资源全部内置**。

很多同类工具首次运行要联网下载平台工具或驱动，遇到网络问题、墙、
或者给一台干净的机器装的时候就卡住。这个工具**离线可用**，
修手机的场景经常就是「手上这台电脑不一定方便上网」。

### 二、多设备不会刷错机器

这是刷机工具最容易出人命的地方。本项目的做法是**结构性防御**，不是靠提示语：

- 写入类动作**必须绑定目标设备序列号**，命令统一通过 `adbFor(payload, ...)`
  注入 `-s SERIAL`，多设备同时连接时不会落到默认设备
- **25 个危险动作**在 `actions.registry.js` 里集中登记，主进程会**拒绝**任何
  缺少 `riskConfirmed` 标记的危险 IPC 请求——绕过界面直接调 IPC 也拦得住
- `erase`（清除数据）**默认跳过**，只有显式选择"完整刷机"入口才执行
- 固件刷机前有**兼容性门禁**：机型、分区表、固件包三者对不上就拦住

> 有一条专门的审计脚本 `npm run audit:danger` 逐项检查这些边界，
> 任何一次改动让它变红都过不了 CI。

### 三、不是"点了没反应"，每步都有账可查

- **任务中心**：长任务显示 `[任务进度] 当前/总数`，运行期间阻止重复扫描
- **操作历史**：写入 `action-history.jsonl`，可回查做过什么
- **完整日志**：一键复制或导出，包含每条 ADB/Fastboot 命令的原始输出
- **失败不静默**：失败路径返回具体错误与设备输出，不会假装成功

很多刷机工具点完只给你一个转圈或者"完成"，出问题无从下手。这里失败时
你能看到**是哪条命令、返回了什么**。

### 四、工程上真的在管质量

| 指标 | 实际情况 |
|---|---|
| 单元与契约测试 | **55 项全绿**（12 个测试文件）|
| 自动化审计 | **10 个独立审计脚本**，覆盖动作契约、危险边界、任务流、UI 状态、无线投屏、无线配对、投屏会话、主题、对比度、文档链接 |
| CI 检查 | **14 项**，GitHub Actions 每次推送自动跑 |
| 语法门禁 | 10 个核心源文件逐个 `node --check` |
| 依赖安全 | 生产依赖 **0 漏洞**（仅 1 个 MIT 许可依赖）|
| 对比度 | 6 套主题 × 6 处文字，用**真实渲染**测 WCAG 对比度，不达标即失败 |

审计脚本用**退出码表达严重程度**（`2` = P0 必修、`1` = 已登记的 P1 缺口、`0` = 通过），
所以 CI 不会把"已知缺口"和"新引入的 bug"混为一谈。

### 五、界面可换，功能不缩水

**6 套界面风格**共用同一组 CSS 变量，只改配色，**布局与功能零改动**。
新增主题必须通过 `npm run audit:contrast`——它会用真实渲染测量
6 处文字在每套主题下的对比度，达不到 4.5 就报错。

### 六、离线资源不进 Git，克隆很轻

`.gitignore` 排除了 7 个大体积资源目录，仓库**只有 86 个文件、约 2.1 MB**。
克隆很快，改代码的人不会被 893 MB 的二进制拖累。

（首次从源码运行需要补齐 `resources/`，见 [`resources/MANIFEST.md`](resources/MANIFEST.md)，
用 `pwsh scripts/verify-resources.ps1` 校验。）

### 七、开源、可改、欢迎接手

MIT 许可，没有闭源组件。源码里**不加密、不混淆**，110 个动作每个都能追到实现。

**想让更多人一起升级优化**是这个项目开源的直接目的——
下面的[一起把它做得更好](#一起把它做得更好)列出了具体能上手的地方，
从写一行文案到加一套主题都有。有任何想法，[开个 Issue](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new/choose)
或者直接提 PR 都行。
## 一起把它做得更好

**不需要会写代码也能帮上忙。** 下面这些 Issue 已经开好，可以直接认领。

| 任务 | 难度 | 需要写代码 |
|---|---|---|
| [#2 新增第 7 套界面风格](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/2) | ⭐⭐ | 会 CSS 就行 |
| [#8 完善中文文案准确性](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/8) | ⭐ | 不需要 |
| [#3 机型实测汇总](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/3) | ⭐ | 不需要 |
| [#6 操作历史界面化](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/6) | ⭐⭐ | 会前端 |
| [#7 审计脚本去重](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/7) | ⭐⭐ | 会 Node |
| [#1 拆分 renderer.js](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/1) | ⭐⭐⭐ | **收益最大** |
| [#4 统一动作分发](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/4) | ⭐⭐⭐ | 需要读代码 |
| [#5 任务取消](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/5) | ⭐⭐⭐ | 有一定难度 |

**这些任务都不碰手机写入**，改坏了 CI 会立刻告诉你。
完整的 11 个任务（含更多文档与工程类）见 [docs/good-first-issues.md](docs/good-first-issues.md)。

### 不写代码也能贡献

| 你能做什么 | 去哪 |
|---|---|
| 报告 bug | [Bug 反馈](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=bug_report.yml) |
| **反馈机型适配** | [机型实测反馈](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=device_report.yml)——**失败的记录同样有价值** |
| 提功能建议 | [功能建议](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=feature_request.yml) |
| 提问 / 求助 | [Q&A 板块](https://github.com/adb-gaoji/adb-gaoji-assistant/discussions/categories/q-a) |
| 机型互助 | [机型实测汇总帖](https://github.com/adb-gaoji/adb-gaoji-assistant/discussions/11) |
| 分享经验 | [General / Show and tell](https://github.com/adb-gaoji/adb-gaoji-assistant/discussions) |

> **第一次提 PR？** 直接说就行，维护者会手把手带。
> 在[「想参与开发？从这里开始」](https://github.com/adb-gaoji/adb-gaoji-assistant/discussions/12)
> 里回一句你的背景（会前端 / 会 Node / 完全没写过），会帮你挑一个最合适的。

### 我们希望这个项目变成什么样

刷机工具圈子里，很多好用的工具最后都停在某个版本不再更新。
这个项目开源，就是想让它**能被接手、能持续活下去**——

- **代码不加密不混淆**，110 个动作每个都能追到实现
- **每个改动都有测试兜底**，新人改了不怕改坏
- **审计脚本告诉你哪里还有坑**，不用猜
- **文档写清楚为什么这么做**，不只是写「怎么做」

如果你也遇到过「找不到一个还在维护的刷机工具」，
欢迎一起来把它做成那个例外。

## 功能特性

**110 个动作**，按功能域划分如下：

<table>
<tr><td width="50%" valign="top">

### 🔍 设备诊断
- 一键设备报告（机型 / 系统 / 内核 / 电量）
- ADB 连接诊断、驱动与端口检查
- 基带诊断、无线协议栈诊断
- Fastboot 变量全量读取
- 分区表结构对比、设备快照对比
- 系统架构与 ABI 明细

### 📱 应用管理
- 应用列表、批量导出 APK
- 单个 / 批量安装与卸载
- 批量冻结 / 解冻（主用户）
- 清理单个应用数据
- 快速启动应用
- 导出应用清单报告

### 🗂️ 存储清理
- 存储占用总览（按类别分项）
- 文件浏览与筛选排序
- 缓存 / 垃圾文件清理
- 照片、视频专项清理
- 批量导出存储文件

### 📡 无线与投屏
- 无线 ADB 连接（Android 11+ 配对码）
- 配对端口与连接端口分离
- scrcpy 投屏（普通 / 高清 / 只看不控）
- 投屏会话管理与状态查询
- 无线投屏前严格参数校验

</td><td width="50%" valign="top">

### 🔓 Root 与面具
- Root 状态与 Magisk 版本检测
- Zygisk 状态检查
- Magisk 模块列表
- DenyList 配置（批量加入已装应用）
- 一键安装 Magisk
- Root 分区一键备份

### ⭐ 谷歌三件套（GMS）
- **深度诊断**：三组件安装 / 启用 / 版本 + 系统与 ABI 报告
- **一键安装**：按 GSF → Play 服务 → Play 商店顺序
- **修复闪退停用**：启用 + `install-existing` + 后台策略放行
- **修复重启失效**：写入 Magisk `service.d` 开机自启脚本
- **修复指定应用**：目标应用连同三组件一起放行并重启
- **打开谷歌服务开关**：自动匹配机型可用入口
- 内置包准备、本地 APK 导入、最新版下载
- 仅运行时放行（无 Root 自动降级）

### 🧩 分区与镜像
- 关键分区备份（boot / vbmeta / dtbo 等）
- 分区镜像提取与刷写
- `payload.bin` 解包
- 临时启动镜像（不改动设备）
- A/B 槽位查询与切换
- 镜像校验

### ⚡ 固件刷机
- 固件包选择与预览（`flashfile.xml` 解析）
- 刷机前兼容性门禁校验
- 完整刷机 / 保留数据刷机
- 断点续刷
- 摩托罗拉 Bootloader 解锁
- 联想深度测试与解锁
- 联想 9008 驱动安装

### 🛡️ 救砖修复
- 救砖诊断向导
- ADB 端口占用修复
- 刷机后 WiFi 失效修复
- 蓝牙软件层修复
- 通话音频修复
- 网络访问修复

### 🎨 个性化
- 开机动画备份 / 替换 / 恢复
- 开机动画兼容性预检
- 分辨率与 DPI 调整
- 屏幕截图、录屏

### 🤖 智能辅助
- AI 智能诊断与故障排查
- AI 编排方案导出
- 任务中心与执行历史
- 完整日志导出

</td></tr>
</table>

> **危险操作有独立门禁。** 刷写、解锁、卸载、清数据、清理媒体、修改显示设置
> 全部需要二次确认；`erase`（清除数据）默认跳过，只有显式选择完整刷机入口才执行。

## 界面风格

内置 **6 套界面风格**，点右上角调色板图标循环切换，选择保存在本地、重启后保持。
所有风格共用同一组 CSS 变量，**只改配色，布局与功能零改动**。

<table>
<tr>
<td align="center" width="33%">
<img src="design/app/graphite.png" alt="深空石墨"><br>
<b>深空石墨</b><br>
<sub>深色 · 中性石墨灰 + 薄荷绿</sub>
</td>
<td align="center" width="33%">
<img src="design/app/indigo.png" alt="午夜靛蓝"><br>
<b>午夜靛蓝</b><br>
<sub>深色 · 深海军蓝 + 靛蓝</sub>
</td>
<td align="center" width="33%">
<img src="design/app/obsidian.png" alt="曜石霓虹"><br>
<b>曜石霓虹</b><br>
<sub>深色 · 纯黑 + 青色霓虹</sub>
</td>
</tr>
<tr>
<td align="center" width="33%">
<img src="design/app/light.png" alt="清亮浅色"><br>
<b>清亮浅色</b><br>
<sub>浅色 · 冷灰底 + 绿色强调</sub>
</td>
<td align="center" width="33%">
<img src="design/app/sand.png" alt="暖云米白"><br>
<b>暖云米白</b><br>
<sub>浅色 · 米白纸面 + 暖棕</sub>
</td>
<td align="center" width="33%">
<img src="design/app/jade.png" alt="墨玉青瓷"><br>
<b>墨玉青瓷</b><br>
<sub>浅色 · 低饱和灰绿 + 玉色</sub>
</td>
</tr>
</table>

想自己加一套？见 [`design/README.md`](design/README.md)。新增主题必须通过
`npm run audit:contrast` —— 它会用真实渲染测量每套主题下 6 处文字的 WCAG 对比度。

## 快速开始

### 直接使用

**这是给普通用户的推荐方式**——下载、安装、连手机，三步就能用，不需要 Node.js，
也不需要做任何额外配置。

1. 从 [Releases](https://github.com/adb-gaoji/adb-gaoji-assistant/releases/latest) 下载 `ADB-GaoJi-Assistant-V1.1.0-Setup.exe`
2. 双击安装（支持自选安装目录，会创建桌面与开始菜单快捷方式）
3. 用数据线连接手机，打开 USB 调试，应用会自动识别

> **安装包是自包含的**：adb/fastboot 平台工具、scrcpy 4.0、安卓 USB 驱动、
> VC++ 运行时、Magisk、谷歌三件套安装包、固件模板——**约 893.7 MB 运行时资源
> 全部打包在里面，装完离线可用**，不需要再联网下载任何组件。
>
> 体积大是因为内置了这些工具，属于有意设计：修手机时那台电脑不一定方便上网。
> 下载完建议按 Release 页面公布的 SHA256 校验一下完整性。

### 从源码运行

> ⚠️ **直接从 Git 克隆的仓库是不完整的。** 为了保持仓库轻量（约 2.1 MB），
> `resources/` 下 **7 个共约 893.7 MB 的二进制资源目录被 `.gitignore` 排除**，
> 克隆后并不存在。缺了它们程序能启动，但**大量功能会不可用或直接报错**
> （见下方对照表）。跑之前先按第 2 步补齐。

```powershell
# 1. 克隆并安装依赖
git clone <仓库地址>
cd adb-gaoji-assistant
npm install

# 2. 补齐运行时资源（二选一）
#    方式 A（推荐）：从 Release 安装包提取
#      下载 ADB-GaoJi-Assistant-V<版本>-Setup.exe，静默安装到临时目录后，
#      把 <安装目录>\resources\resources\ 整个复制到本仓库的 resources\ 下。
#    方式 B：自行准备（版本见 resources/MANIFEST.md）
#      resources\platform-tools\   adb.exe / fastboot.exe
#      resources\scrcpy\scrcpy-win64-v4.0\
#      resources\gms\              谷歌三件套安装包
#      resources\drivers\ resources\apk\ resources\bundled-tools\ resources\tea-templates\

# 3. 校验资源是否齐全（会逐项列出缺失的文件）
pwsh scripts/verify-resources.ps1

# 4. 启动
npm start
```

**缺资源时会怎样**（这就是为什么必须补齐）：

| 缺失目录 | 影响 |
|---|---|
| `platform-tools/` | **核心功能全部不可用**——设备识别、ADB、Fastboot 全废 |
| `scrcpy/` | 投屏功能不可用，点开会提示缺少 scrcpy |
| `gms/` | 谷歌三件套「一键安装」不可用 |
| `tea-templates/` | Tea 引导制作不可用 |
| `bundled-tools/` | 9008 救砖、工具箱不可用 |
| `drivers/` | 「安装驱动」不可用 |
| `apk/` | Root 与部分应用管理功能不可用 |

**只想用工具、不想折腾？** 直接用 [Release 安装包](#直接使用)，
里面资源是完整的，装完就能用。

### 打包

```powershell
npm run dist              # 仅打包 → dist\ADB搞机助手_V<版本>_安装包.exe
npm run release:install   # CI → 打包 → 归档 → 安装 → 验证 → 提交打 tag
```

> **打包同样需要完整的 `resources/`**：缺文件时打出来的安装包会缺功能。
> 打包前先跑 `pwsh scripts/verify-resources.ps1`。

## 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11 x64 |
| Node.js | 24（仅源码运行与打包需要） |
| PowerShell | 7（`pwsh`）推荐，5.1 也可运行脚本 |
| 磁盘空间 | 安装后约 1.4 GB（含内置驱动与固件模板） |

## 架构说明

Electron 三层结构，主进程与渲染进程通过 IPC 通信：

```
┌─────────────────────────────────────────────────────────┐
│  渲染进程 (renderer.js / .html / .css)                    │
│  界面、状态管理、二次确认                                   │
└────────────────────────┬────────────────────────────────┘
                         │ preload.js  contextBridge
                         │ window.gaoji.run(action, payload)
┌────────────────────────┴────────────────────────────────┐
│  主进程 (main.js)                                         │
│  窗口、IPC、外部进程执行、动作分发、危险操作门禁                │
└────────────────────────┬────────────────────────────────┘
                         │ dispatchAction / handlers[action]
┌────────────────────────┴────────────────────────────────┐
│  动作处理器 (action_handlers.js，110 个动作)                │
│  adb / fastboot 调用、文件操作、结果解析                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────┐
│  纯函数模块（不依赖 Electron，可直接单元测试）                 │
│  firmware_parser.js · adb_parser.js · actions.registry.js │
└─────────────────────────────────────────────────────────┘
```

### 关键设计

| 模块 | 作用 |
|---|---|
| `src/actions.registry.js` | **动作元数据的唯一来源**。危险等级、是否需要 Fastboot / ADB、是否需二次确认全部在此登记，主进程与界面都从这里派生，避免两侧判定漂移 |
| `src/firmware_parser.js` | 固件 XML 解析与 fastboot 命令生成（纯函数） |
| `src/adb_parser.js` | `adb devices -l` / `fastboot devices -l` 输出解析（纯函数） |
| `src/preload.js` | `contextBridge` 暴露 `window.gaoji`，渲染进程无 Node 权限 |

解析类逻辑特意与 Electron 解耦，就是为了能脱离窗口直接跑测试。

## 测试与质量保障

```powershell
npm run check    # 语法检查（node --check 全部源文件）
npm test         # 语法检查 + 54 项单元/契约测试
npm run ci       # 完整 CI：语法 → 测试 → 依赖审计 → 9 项审计 → 资源校验
```

CI 共 **14 项检查**。除单元测试外，还有一组**后台审计脚本**，
不启动 Electron 窗口即可校验跨层契约：

| 审计 | 校验内容 |
|---|---|
| `audit:actions` | `ACTION_IDS`、handlers、界面注册三处是否一致 |
| `audit:danger` | 主进程门禁、注册表与界面二次确认是否对齐 |
| `audit:tasks` | 任务中心状态流转 |
| `audit:ui-state` | 界面状态、筛选与滚动契约 |
| `audit:wireless-cast` | 无线投屏参数与设备绑定 |
| `audit:wireless-pair` | 无线 ADB 配对端口与顺序 |
| `audit:mirror-session` | 投屏会话生命周期 |
| `audit:themes` | 6 套主题的 CSS 变量是否完整 |
| `audit:contrast` | 真实渲染下测量 6 套主题 × 6 处文字的 WCAG 对比度 |
| `audit:links` | 文档里的相对链接与页内锚点是否有效（防死链） |

审计脚本用退出码表达严重度：

| 退出码 | 含义 | 是否阻断 |
|---|---|---|
| `0` | 通过 | 否 |
| `1` | 存在已在 `ROADMAP.md` 登记的 P1 缺口 | 否（警告） |
| `2` | 存在 P0 必须修的问题 | **是** |

### 回归测试覆盖的真实事故

`tests/v1.0.0-regression.test.js` 专门守着**已经实际出过问题**的边界，
改动这些函数会让测试立刻失败：

| 曾经的缺陷 | 后果 |
|---|---|
| `parseFirmwareXml` 跳过 `<step>` 标签 | 摩托罗拉/联想固件解析出 0 条命令，刷机包选择直接报错 |
| `shellArg` 引号转义缺失（23 处调用） | `su -c "…"` 参数被拆散，命令静默失败 |
| `parseAdbDevices` 用错截断参数 | 机型与传输 ID 丢失 |
| `erase` 默认放行 | 误清用户数据 |
| Root 检测无超时 | 设备异常时界面卡死 |

## 项目结构

```
src/
  main.js                 主进程：窗口、IPC、过程执行、动作分发
  action_handlers.js      110 个动作处理器
  actions.registry.js     动作元数据唯一来源（危险/安装/Fastboot/ADB）
  firmware_parser.js      固件 XML 解析与命令生成（纯函数）
  adb_parser.js           设备列表解析（纯函数）
  renderer.js / .html / .css   渲染进程界面与 6 套主题
  preload.js              contextBridge
  app_package_query.js    应用列表查询
  device_reboot.js        重启动作
  firmware-catalog.js     固件下载目录
scripts/
  ci.ps1                  完整 CI
  release.ps1             发布流程
  verify-resources.ps1    资源完整性校验
  audit-*.js              10 项契约审计
tests/                    单元与契约测试（54 项）
design/                   界面风格定义、对比页、应用截图
resources/                运行时资源（不纳入版本控制，见下）
```

## resources 与体积

`resources/` 存放随包分发的大体积二进制资源，**合计约 894 MB，不纳入版本控制**：

| 内容 | 体积 |
|---|---|
| Tea 模板（A/B 槽位镜像已去重） | 480 MB |
| scrcpy | 39.8 MB |
| platform-tools（adb / fastboot） | — |
| 驱动包、内置 APK、GMS 组件 | — |

克隆仓库后需补齐该目录，否则对应功能与打包会缺文件：

```powershell
pwsh -File scripts/verify-resources.ps1    # 查看缺哪些
```

清单、用途与 SHA256 校验值见 [`resources/MANIFEST.md`](resources/MANIFEST.md)。

## 支持机型与固件

本工具通过标准的 `adb` / `fastboot` 协议与设备通信，**协议层面不限定品牌**，
能识别的机型取决于 adb / fastboot 驱动与设备自身的支持情况。

已验证的专项功能（有对应的固件解析与解锁流程）：

| 品牌 | 专项支持 |
|---|---|
| 摩托罗拉 | 固件 `flashfile.xml` 解析、Bootloader 解锁 |
| 联想 | 深度测试、9008 驱动、解锁流程 |
| 通用 Android | 分区备份/刷写、应用管理、存储清理、投屏、开机动画 |

无线 ADB 需要 **Android 11 及以上**（配对码方式）。

> 机型兼容性依赖设备实际状态与固件版本。**这份列表不是保证**，
> 刷机前请自行核对机型与固件匹配性。欢迎在
> [Issues](https://github.com/adb-gaoji/adb-gaoji-assistant/issues) 反馈你的实测结果，帮助完善这份列表。

## 安全边界

本工具直接操作真实设备的存储分区，请务必理解以下边界：

- **涉及设备写入的功能**（刷机、解锁、清数据、写分区）必须人工核对机型、
  系统版本、槽位与备份，并经过界面二次确认。
- 固件刷机中的 `erase`（清除数据）步骤**默认跳过**，只有显式选择完整刷机入口才执行。
- 固件刷机**绑定目标序列号**，连接多台 Fastboot 设备时不会刷错机器。
- 设备不匹配、权限不足、备份失败都会**阻止写入**，不会降级继续。
- 自动化测试只做静态契约与 mock 校验，**不执行**真实刷机、解锁、分区写入、
  恢复出厂或不可恢复的数据删除。
- 任何刷机操作都存在风险。**请先备份关键分区**，并确认你了解恢复手段。

发现安全问题请按 [`SECURITY.md`](SECURITY.md) 的流程反馈。

## 常见问题

<details>
<summary><b>连接手机后应用识别不到设备？</b></summary>

按顺序排查：

1. 手机端确认已打开**开发者选项 → USB 调试**
2. 数据线连接后，手机弹出的「允许 USB 调试」授权框要点**允许**
3. 如果手机只充电不传输，把 USB 模式改为「文件传输 / MTP」
4. 电脑端缺驱动时，用界面上的「安装 ADB 驱动」功能
5. 仍不行时用「ADB 连接诊断」，它会指出具体卡在哪一步

部分机型（尤其国产 ROM）需要在开发者选项里额外打开「USB 调试（安全设置）」。

</details>

<details>
<summary><b>设备显示「未授权」怎么办？</b></summary>

手机上没有点「允许」授权框，或之前点了「拒绝」。解决方法：

1. 手机端「开发者选项」里点**撤销 USB 调试授权**
2. 重新插拔数据线，再次弹出授权框时点**允许**
3. 勾选「一律允许使用这台计算机进行调试」

用「ADB 授权修复」功能也可以触发重新授权。

</details>

<details>
<summary><b>刷机时提示找不到刷机包 / 解析失败？</b></summary>

固件需要先**解压官方 ZIP**，再选择解压目录里的 `flashfile.xml`。
不要直接选 ZIP 压缩包本身。用「固件预览」可以先看到解析出的命令列表，
确认无误再刷。

</details>

<details>
<summary><b>刷机后 WiFi 打不开 / 没有信号？</b></summary>

通常是刷机时跳过了基带或持久化分区。可以尝试：

1. 「救砖修复 → 刷机后 WiFi 失效修复」
2. 重新完整刷入官方固件（不要跳过任何分区）
3. 检查 `persist`、`modem` 分区是否被覆盖

</details>

<details>
<summary><b>无线 ADB 连不上？</b></summary>

Android 11+ 需要**配对码**流程，注意区分两个端口：

- **配对端口**：在「无线调试 → 使用配对码配对设备」里显示，用于首次配对
- **连接端口**：在「无线调试」主界面显示，用于配对之后的连接

手机和电脑必须在**同一个局域网**。用「无线配对」功能按顺序走，
它会分别校验两个端口的格式。

</details>

<details>
<summary><b>界面字体太小 / 想换配色？</b></summary>

点右上角**调色板图标**可在 6 套风格间循环切换，选择会保存在本地。
深色、浅色各 3 套，见[界面风格](#界面风格)。

</details>

<details>
<summary><b>从源码运行时提示资源缺失？</b></summary>

`resources/` 目录约 894 MB，不纳入版本控制。运行
`pwsh -File scripts/verify-resources.ps1` 查看缺哪些文件，
清单与来源见 [`resources/MANIFEST.md`](resources/MANIFEST.md)。

</details>

<details>
<summary><b>日志在哪里？</b></summary>

```
%APPDATA%\adb-gaoji-assistant-next\
```

崩溃时会额外生成 `crash.log`。日志会自动轮转（单文件上限 2 MB，保留 3 份），
不会无限增长。提交 Issue 时请附上相关片段，**并先删除设备序列号等隐私信息**。

</details>

## 文档导航

| 文档 | 内容 |
|---|---|
| [`VERSIONS.md`](VERSIONS.md) | **面向用户的版本升级说明**，逐版本记录改了什么 |
| [`docs/good-first-issues.md`](docs/good-first-issues.md) | **11 个适合上手的任务**，含难度分级与完成标准 |
| [`SUPPORT.md`](SUPPORT.md) | 遇到问题先看这里：排查步骤与提问模板 |
| [`ROADMAP.md`](ROADMAP.md) | 开发计划、优先级、已登记的 P1 缺口 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献指南、代码规范、危险操作要求、发布流程 |
| [`CHANGELOG.md`](CHANGELOG.md) | 开发明细，含 20.x 内部迭代系列 |
| [`SECURITY.md`](SECURITY.md) | 安全策略、信任边界与漏洞反馈流程 |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | 社区行为准则 |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | 第三方组件许可声明 |
| [`design/README.md`](design/README.md) | 界面风格的 CSS 变量接口与新增步骤 |
| [`resources/MANIFEST.md`](resources/MANIFEST.md) | 运行时资源清单与 SHA256 |
| [`README-开始项目.md`](README-开始项目.md) | 开发流程、审计脚本、发布开关详解 |

## 参与贡献

欢迎任何人参与改进。不需要会写代码也能帮上忙：

- **缺陷报告** — 附上日志能大幅加快定位
- **机型实测反馈** — 新机型/新固件的测试结果对刷机功能最有价值
- **文档改进** — 错别字、表述不清，直接提 PR
- **新增界面风格** — 按 [`design/README.md`](design/README.md) 操作
- **功能开发** — 建议先在 Issue 里讨论方向

开始之前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
**涉及设备写入的改动有额外的安全要求**，请特别留意那一节。

## 许可证

[MIT](LICENSE) © 2026 ADB搞机助手 contributors

## 致谢

本项目集成了以下开源项目与工具的资源，在此致谢：

- [scrcpy](https://github.com/Genymobile/scrcpy) — 投屏内核
- [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) — adb / fastboot
- [Magisk](https://github.com/topjohnwu/Magisk) — Root 方案
- [Phosphor Icons](https://phosphoricons.com/) — 界面图标
- [Electron](https://www.electronjs.org/) — 桌面运行时

---

<div align="center">
<sub>

**刷机有风险，操作前请务必备份。** 本项目按 MIT 许可「按原样」提供，
不附带任何明示或暗示的担保。

</sub>
</div>
