# 贡献指南

感谢你有兴趣改进 ADB搞机助手。本文档说明如何搭建环境、提交改动，以及本项目对
**涉及设备写入的代码**的额外要求。

---

## 目录

- [行为准则](#行为准则)
- [我能贡献什么](#我能贡献什么)
- [开发环境](#开发环境)
- [开始之前](#开始之前)
- [代码规范](#代码规范)
- [提交改动](#提交改动)
- [危险操作的额外要求](#危险操作的额外要求)
- [新增动作](#新增动作)
- [新增界面风格](#新增界面风格)
- [提交信息规范](#提交信息规范)
- [Pull Request 流程](#pull-request-流程)
- [发布新版本](#发布新版本维护者)

---

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 我能贡献什么

不需要会写代码也能帮上忙：

| 类型 | 说明 |
|---|---|
| 缺陷报告 | 按 [Issue 模板](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new/choose) 提交，**务必附上日志**（见下） |
| 机型反馈 | 新机型/新固件的实测结果，这对刷机功能最有价值 |
| 文档改进 | 错别字、表述不清、缺少说明，直接提 PR |
| 界面风格 | 按 [`design/README.md`](design/README.md) 新增一套主题 |
| 功能开发 | 先在 Issue 里讨论，避免写完才发现方向不对 |
| 代码审查 | 对开放中的 PR 提出意见同样算贡献 |

### 提交缺陷前请先收集日志

应用运行日志位于：

```
%APPDATA%\adb-gaoji-assistant-next\
```

崩溃时会额外生成 `crash.log`。Issue 里附上相关片段能极大加快定位速度。
**粘贴前请先删除设备序列号、账号等隐私信息。**

## 开发环境

| 要求 | 版本 |
|---|---|
| 操作系统 | Windows 10/11 x64（本项目仅支持 Windows） |
| Node.js | 24 |
| PowerShell | 7（`pwsh`）推荐；脚本已带 UTF-8 BOM，5.1 也能跑 |

```powershell
git clone <仓库地址>
cd adb-gaoji-assistant
npm install
npm start
```

### 补齐运行时资源

`resources/` 存放随包分发的大体积二进制资源（约 894 MB），**不纳入版本控制**。
缺少它时相关功能不可用、也无法打包：

```powershell
pwsh -File scripts/verify-resources.ps1    # 查看缺哪些
```

清单、用途与 SHA256 校验值见 [`resources/MANIFEST.md`](resources/MANIFEST.md)。

## 开始之前

```powershell
npm test        # 语法检查 + 54 项单元/契约测试
npm run ci      # 完整 CI：语法 → 测试 → 依赖审计 → 9 项审计 → 资源校验
```

**提交 PR 前 `npm run ci` 必须通过。** CI 只在出现 P0 问题时失败；已在
`ROADMAP.md` 登记的 P1 缺口以警告形式列出，不阻断。

### 审计脚本的退出码约定

理解这个约定能帮你判断自己的改动是否引入了问题：

| 退出码 | 含义 | 是否阻断 |
|---|---|---|
| `0` | 通过 | 否 |
| `1` | 存在已在 `ROADMAP.md` 登记的 P1 缺口 | 否（警告） |
| `2` | 存在 P0 必须修的问题 | **是** |

如果你**有意**引入一个新的 P1 缺口（例如分阶段实现某个功能），请同时在
`ROADMAP.md` 中登记它，并在 PR 描述里说明。

## 代码规范

### 通用

- 源码统一 **UTF-8**。PowerShell 脚本必须带 **BOM**（否则 Windows PowerShell 5.1
  会按 GBK 解析导致中文乱码）；JSON 文件**不能**带 BOM（否则 Node 的 `require`
  会抛 `SyntaxError`）。
- 缩进 2 空格，单引号优先，语句结尾带分号，与现有风格保持一致。
- 中文注释与中文界面文案是本项目的既有约定，请沿用。

### 架构约定

代码分成三层，改动请放在正确的层：

| 位置 | 职责 |
|---|---|
| `src/main.js` | 主进程：窗口、IPC、外部进程执行、动作分发 |
| `src/action_handlers.js` | 动作处理器，`handlers['动作名'] = async (payload) => {}` |
| `src/renderer.js` / `.html` / `.css` | 渲染进程界面 |

**能写成纯函数就不要依赖 Electron。** 解析类逻辑（`firmware_parser.js`、
`adb_parser.js`）特意与 Electron 解耦，就是为了能直接单元测试。新增解析逻辑
请照此办理。

### 动作元数据是唯一来源

危险等级、是否需要 Fastboot、是否需要二次确认等信息统一登记在
`src/actions.registry.js`，**不要在界面或处理器里重复硬编码**。`npm run audit:danger`
会校验主进程门禁、注册表与界面二次确认三者是否一致。

## 提交改动

### 基本流程

```powershell
git checkout -b fix/固件解析空命令
# 改动…
npm test
npm run ci
git commit -m "fix: 固件 XML 解析跳过 step 标签导致命令为空"
git push origin fix/固件解析空命令
```

### 测试要求

- 修缺陷请**附带能复现该缺陷的测试**，且该测试在修复前应当失败。
- 新增解析逻辑请写单元测试。
- `tests/v1.0.0-regression.test.js` 覆盖的是**已经实际出过问题**的边界
  （`shellArg` 引号转义、`parseFirmwareXml` 的 `<step>` 解析、`erase` 严格 opt-in、
  `parseAdbDevices` 字段完整性等）。**不要为了让测试通过而放宽这些断言** ——
  它们对应的都是真实事故。若确实需要改动，请在 PR 中说明原因。

## 危险操作的额外要求

本项目直接操作真实设备的存储分区。**这是最重要的一节。**

涉及刷写、解锁、清数据、写分区、恢复出厂的改动，除了常规审查还要满足：

1. **默认安全**：有破坏性的行为必须**显式开启**。例如固件刷机中的 `erase`
   默认跳过，只有走完整刷机入口才执行。
2. **设备绑定**：写入操作必须绑定目标序列号，连接多台设备时不能刷错机器。
3. **二次确认**：必须经过界面确认，且确认文案要让用户清楚后果。
4. **失败即中止**：设备不匹配、权限不足、备份失败都必须阻止写入，不得降级继续。
5. **不新增自动化真实写入**：测试只做静态契约与 mock 校验，**不得**执行真实刷机、
   解锁、分区写入或不可恢复的数据删除。

上面每一条都有对应的审计脚本或契约测试在把关。**绕过它们等于把风险转嫁给用户。**

## 新增动作

1. 在 `src/actions.registry.js` 登记元数据（危险等级、是否需要 ADB/Fastboot、是否需二次确认）。
2. 在 `src/action_handlers.js` 的 `ACTION_IDS` 中加入动作名，并实现
   `handlers['动作名']`。
3. 如需主进程专属能力，在 `src/main.js` 的 `dispatchAction` 中增加分支。
4. 在界面注册入口。
5. 跑 `npm run audit:actions` 与 `npm run audit:danger` 确认三处一致。
6. 补充测试。

## 新增界面风格

见 [`design/README.md`](design/README.md)。核心是：在 `src/styles.css` 中新增
一个 `:root[data-theme="你的主题"]` 块，补齐全部 CSS 变量，并在 `src/renderer.js`
的 `THEMES` 数组中登记。

**必须确认 `npm run audit:themes` 与 `npm run audit:contrast` 都通过** ——
后者会用真实渲染测量 6 处文字在每套主题下的 WCAG 对比度，深色底配深色字这类
问题会被直接拦下。新增主题的截图请放进 `design/app/`。

## 提交信息规范

采用约定式提交（Conventional Commits）：

```
<类型>: <简短描述>
```

| 类型 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 仅文档 |
| `style` | 界面风格或格式，不影响逻辑 |
| `refactor` | 重构，不改变行为 |
| `test` | 测试 |
| `chore` | 构建、依赖、脚本 |
| `perf` | 性能 |

示例：

```
feat: 新增墨玉青瓷界面风格
fix: 固件 XML 解析跳过 step 标签导致命令为空
docs: 补充无线配对端口说明
```

描述用中文或英文均可，与仓库现有记录保持一致即可。

## Pull Request 流程

1. Fork 仓库并从 `main` 创建分支。
2. 完成改动，确保 `npm test` 与 `npm run ci` 通过。
3. 提交 PR，填写模板；**说明改动原因而不只是改了什么**。
4. 涉及界面的改动请附截图或录屏（新增主题必须附 `design/app/` 截图）。
5. 涉及设备写入的改动请明确说明你已经验证的安全边界。
6. 等待审查。维护者可能会要求补充测试或调整实现。

### 审查会关注什么

- 是否引入了新的危险默认值
- 错误路径是否被正确覆盖（失败时会不会静默继续）
- 中文文案是否准确、有无误导
- 测试是否真的能捕获它声称捕获的问题
- 是否与 `actions.registry.js` 的登记保持一致

---

## 发布新版本（维护者）

发版由维护者执行，普通贡献者不需要跑这套流程。

### 会改动版本号的文件

改版本号时**四处必须同步**，CI 的「项目元数据校验」会检查 `package.json` 与
`package-lock.json` 是否一致，以及 `VERSIONS.md` 是否含当前版本段落：

| 文件 | 改什么 |
|---|---|
| `package.json` | `version` |
| `package-lock.json` | 根节点与 `packages[""]` 下的 `version`（跑 `npm install` 会自动同步）|
| `VERSIONS.md` | 新增 `【x.y.z】` 段落，写在最前面 |
| `README.md` | 徽章里的版本号与下载文件名 |

`resources/` 下的内置工具清单（`resources/MANIFEST.md`）如需同步更新校验值。

### 发布步骤

```powershell
# 1. 确认全绿
npm test
npm run ci

# 2. 打包 + 归档到桌面 + 静默安装 + 验证单窗口 + 展示升级说明
npm run release:install

# 3. 提交并打 tag（release.ps1 可用 -NoGit 跳过这一步自己控制）
git push origin main
git tag v1.1.0
git push origin v1.1.0

# 4. 在 GitHub 上创建 Release，上传安装包
$env:GITHUB_TOKEN = '<token>'
node scripts/upload-release.js v1.1.0 --archive "$env:USERPROFILE\Desktop\ADB搞机助手"
```

### 关于上传脚本

`scripts/upload-release.js` 显式使用 ASCII 附件名
（`ADB-GaoJi-Assistant-V<版本>-Setup.exe`）。原因：GitHub 上传附件时会**剥离
非 ASCII 文件名**，`ADB搞机助手_V1.1.0_安装包.exe` 会变成 `ADB._V1.1.0_.exe`，
与 README、`VERSIONS.md` 和自动更新配置里写的名字全部对不上。

脚本是幂等的：同名附件已存在时直接跳过，重跑不会重复占用带宽。

### 关于 CI 与资源的差异

`.gitignore` 排除了七个体积较大的 `resources/*` 子目录（scrcpy、platform-tools、
drivers 等），CI 克隆后这些目录并不存在。因此：

- 单元测试**不得**依赖真实 `resources/` 目录里的二进制文件，
  需要时应自己造临时目录（参考 `tests/v20.5.8-mirror-session.test.js`）；
- 涉及这些资源的审计需要真机或完整资源目录时才跑得动，属于本地验证范围。

---

再次感谢你的贡献。涉及真实设备存储的操作请务必谨慎。
