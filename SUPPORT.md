# 获取帮助

先看这里，能解决大部分问题。

---

## 一、安装或启动问题

### 双击没反应 / 装完打不开

1. 确认系统是 **Windows 10/11 x64**（本项目不支持 32 位与 ARM）
2. 到 `%LOCALAPPDATA%\Programs\adb-gaoji-assistant-next\` 直接双击
   `ADB搞机助手.exe` 试试，看是否有报错弹窗
3. 检查 `%APPDATA%\adb-gaoji-assistant-next\` 下有没有崩溃日志
4. 确实不行就到 [Issues](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=bug_report.yml)
   反馈，**附上崩溃日志内容**

### 下载慢 / 下载中断

安装包约 525 MB。**体积大是有意的**——adb/fastboot 平台工具、scrcpy、
安卓 USB 驱动、VC++ 运行时、Magisk、谷歌三件套安装包、固件模板
（合计约 893.7 MB 运行时资源）全部打包在里面，**装完离线可用**，
不需要再联网下载任何组件。

GitHub 直连慢的话可以用镜像加速，或者用下载工具续传。下完建议校验一下：

```powershell
Get-FileHash .\ADB-GaoJi-Assistant-V1.1.0-Setup.exe -Algorithm SHA256
```

和 Release 页面公布的 SHA256 对比，一致才说明文件完整。

### 装完之后还要额外下载东西吗？

**不需要。** 下载这一个安装包就够了，装完所有功能都能直接用。

> 例外：如果你是**从 Git 源码运行**（而不是用安装包），需要自己补齐 `resources/`
> 下的运行时资源——那些大文件没有进版本控制。见
> [README 的从源码运行章节](README.md#从源码运行)。
> 缺资源时的典型症状是「设备识别不了」「投屏点了没反应」。

---

## 二、设备连不上

### 电脑认不到手机

按顺序排查：

1. **手机端**：设置 → 关于手机 → 连点「版本号」7 次 → 开发者选项 →
   打开「USB 调试」
2. **数据线**：换一根**能传数据**的线（很多充电线只有电源线）
3. **驱动**：用本工具的「安装 ADB 驱动」功能装一遍驱动
4. **端口**：用「ADB 端口占用修复」检查 5037 是否被占用
5. **USB 模式**：手机下拉通知栏，把 USB 用途从「仅充电」改成「传输文件」

### 显示"未检测到设备"

- 手机上会弹「允许 USB 调试吗」，**要勾选「一直允许」并确定**
- 部分机型需要在开发者选项里额外打开「USB 调试（安全设置）」
- 无线调试的话确认手机和电脑在**同一局域网**

### 多设备时选错机器

本工具**写入类操作会绑定你选中的设备序列号**，不会刷错。
但还是要确认界面上选的序列号就是你目标机器的。

---

## 三、功能异常

### 谷歌三件套装了不能用

这正是本项目的主打功能。不要自己折腾，直接用「谷歌三件套修复」页面：

| 现象 | 用哪个按钮 |
|---|---|
| 不知道装没装 | 深度诊断环境 |
| 闪退 / 打不开 | 一键安装 / 更新 |
| 反复"已停止运行" | 修复 Play 服务停止 |
| 重启就失效 | 修复重启后失效 |
| 某个应用提示需要谷歌服务 | 修复应用运行 |

详见 [README 的谷歌三件套章节](README.md#-主打功能谷歌三件套修复)。

**注意**：部分修复会清理 Play 服务数据，**Google 账号需要重新登录**。

### 刷机失败

1. 先看日志窗口输出的**具体哪条命令失败**，以及返回内容
2. 确认固件包与该机型匹配（本工具有兼容性门禁，但拦不住所有情况）
3. 检查数据线与 USB 口，刷机过程中**不要拔线**
4. 如果是 `flashfile.xml` 解析出来的命令数为 0，
   **这是个 bug，请反馈**并附上该 XML 文件（脱敏后）

### 投屏黑屏 / 卡顿

- 试「普通模式」，高清模式对带宽和手机性能要求更高
- 无线投屏卡的话换 USB
- 部分机型不支持音频转发，工具会提示

---

## 四、怎么问才能快速得到答复

一条**有效的反馈**包含：

1. **应用版本**（界面左下角或 `VERSIONS.md`）
2. **手机机型 + Android 版本 + 系统版本**（如 `Redmi K60 Pro / Android 14 / HyperOS 1.0.5`）
3. **你做了什么**（点哪个按钮、传了什么参数）
4. **期望结果 vs 实际结果**
5. **日志**：界面有「复制日志」和「导出日志」，贴上来

> **一定要脱敏**：贴日志前删掉设备序列号、IMEI、手机号等隐私信息。

信息越全，越有可能一次就定位到。

---

## 五、去哪反馈

| 目的 | 去哪 |
|---|---|
| 报告 bug | [Bug 反馈](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=bug_report.yml) |
| 反馈机型适配 | [机型实测反馈](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=device_report.yml) |
| 提功能建议 | [功能建议](https://github.com/adb-gaoji/adb-gaoji-assistant/issues/new?template=feature_request.yml) |
| 用法交流 / 提问 | [Discussions](https://github.com/adb-gaoji/adb-gaoji-assistant/discussions) |
| 报告安全漏洞 | [安全策略](SECURITY.md)（**不要开公开 Issue**）|
| 想参与开发 | [CONTRIBUTING.md](CONTRIBUTING.md) 和[新手任务清单](docs/good-first-issues.md) |

---

## 六、关于响应时间

这是个**业余时间维护的开源项目**，没有专职客服。维护者会尽量回复，
但请不要期待即时响应。

想让它变快的话——[一起来改](CONTRIBUTING.md)是最有效的办法。
