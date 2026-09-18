# 安全策略

## 报告安全问题

如果你发现了安全漏洞，请**不要**通过公开 Issue 报告。

请使用 GitHub 的[私密漏洞报告](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
功能，在本仓库的 **Security → Report a vulnerability** 提交。

报告时请尽量包含：

- 问题类型（如命令注入、路径穿越、权限提升等）
- 受影响的文件与版本
- 复现步骤
- 可能的影响范围
- 如果方便，附上修复建议

我们会在 **7 天内**确认收到并给出初步判断，在修复发布后再公开致谢。

## 支持的版本

| 版本 | 是否接收安全修复 |
|---|---|
| 1.1.x | ✅ |
| 1.0.x | ✅ |
| 20.x 及更早 | ❌（内部迭代系列，请升级） |

## 本项目的安全模型

理解这一点有助于判断哪些问题属于安全漏洞。

### 信任边界

```
┌──────────────────────────────────────────────┐
│  渲染进程 —— 不可信                              │
│  contextIsolation: true, nodeIntegration: false │
│  只能通过 preload 暴露的 window.gaoji 调用动作      │
└───────────────────┬──────────────────────────┘
                    │ IPC: action:run
┌───────────────────┴──────────────────────────┐
│  主进程 —— 信任边界                              │
│  校验参数、决定是否放行、执行外部进程               │
└───────────────────┬──────────────────────────┘
                    │ spawn(adb|fastboot, args)
┌───────────────────┴──────────────────────────┐
│  外部程序与设备 —— 完全不可信                     │
│  adb / fastboot 输出需按不可信输入解析             │
└──────────────────────────────────────────────┘
```

**渲染进程被当作不可信输入源。** 所有动作参数在主进程侧重新校验，
不依赖界面已经检查过。

### 已有的防护措施

| 风险 | 措施 |
|---|---|
| 命令注入 | 所有外部进程调用走 `spawn` 的参数数组，不拼接 shell 字符串；必须经 shell 时用 `shellArg()` 转义引号 |
| 设备序列号注入 | `serialName()` 用 `/^[A-Za-z0-9._:-]+$/` 白名单校验 |
| 刷错设备 | 写入类动作绑定目标序列号，多设备时拒绝执行 |
| 误清数据 | `erase` 严格 opt-in，`allowErase === true` 才执行 |
| 误操作 | 危险动作经 `actions.registry.js` 登记，主进程门禁与界面二次确认双向校验 |
| 界面卡死 | 外部进程调用带超时，超时后终止 |
| 日志无限增长 | 自动轮转，单文件上限 2 MB，保留 3 份 |
| 崩溃无记录 | 崩溃捕获写入 `crash.log` |
| 依赖漏洞 | CI 中 `npm audit --omit=dev` 校验，生产依赖保持 0 漏洞 |

### 明确不属于漏洞的情况

以下情况是**设计如此**，不作为安全漏洞处理：

- **以管理员权限运行、能读写任意文件**：本工具需要访问设备与磁盘，这是功能前提。
- **执行任意 adb / fastboot 命令**：这是工具的核心用途。
- **写入设备分区**：这是刷机功能的定义。危险动作已有二次确认与序列号绑定。
- **本地用户能修改自己的配置与日志**：配置文件与日志属于当前用户，无跨用户边界。
- **开发依赖中的漏洞**（`npm audit` 报告的 dev 依赖）：这些不进入发布产物。
  CI 只校验生产依赖（`--omit=dev`）。
- **需要攻击者已具备本机代码执行能力**才能触发的本地问题：此时信任边界已被突破。

### 特别欢迎报告的问题

- **绕过二次确认或危险动作门禁**，使写入操作无需确认即可执行
- **绕过设备序列号绑定**，导致多设备场景下刷错机器
- **渲染进程可触达的越权动作**，例如未在 registry 登记却能写入设备的动作
- **`shellArg()` 转义绕过**，构造出注入的命令
- **解析外部输入时导致的越权或提权**（adb / fastboot 输出、固件 XML）
- **`erase` 门禁绕过**

## 安全相关的设计约定

改动以下代码时请特别注意，并在 PR 中说明安全影响：

| 位置 | 关注点 |
|---|---|
| `src/main.js` `dispatchAction` | 危险动作门禁、序列号校验、参数校验 |
| `src/action_handlers.js` | 外部进程调用、`shellArg()` 使用、路径拼接 |
| `src/actions.registry.js` | 危险动作登记是否完整 |
| `src/preload.js` | 暴露给渲染进程的 API 面 |
| `src/firmware_parser.js` | 固件 XML 解析、`erase` 处理 |

### 新增外部进程调用的要求

```js
// 正确：参数数组，不经过 shell
spawn('adb', ['-s', serial, 'shell', 'pm', 'list', 'packages']);

// 必须经过 shell 时：用 shellArg() 转义，不要手写引号
spawn('adb', ['-s', serial, 'shell', `su -c ${shellArg(command)}`]);

// 错误：字符串拼接，用户输入可直接注入
exec(`adb -s ${serial} shell ${userInput}`);
```

## 自动化校验

CI 中包含与安全相关的检查，改动会被自动拦下：

| 检查 | 内容 |
|---|---|
| `npm audit --omit=dev` | 生产依赖漏洞 |
| `audit:danger` | 主进程门禁、注册表、界面确认三者一致性 |
| `audit:actions` | 是否存在未登记的动作 |
| `tests/v1.0.0-regression.test.js` | `shellArg` 转义、`erase` 严格 opt-in 等边界 |

详见 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 [`README.md`](README.md#测试与质量保障)。
