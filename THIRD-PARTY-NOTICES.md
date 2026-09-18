# 第三方组件许可声明

ADB搞机助手以 [MIT 许可](LICENSE)发布。本项目集成了以下第三方组件，
它们各自遵循原有许可。**分发本项目时请一并保留本文件。**

---

## 随安装包分发的组件

这些组件的二进制文件会随本项目构建的安装包一起分发。

### scrcpy

- **用途**：投屏功能内核
- **许可**：Apache License 2.0
- **来源**：<https://github.com/Genymobile/scrcpy>
- **位置**：`resources/scrcpy/`
- **义务**：保留版权声明与许可副本；若修改其源码需标注改动。
  **本项目未修改 scrcpy 源码。**

### Android Platform Tools（adb / fastboot）

- **用途**：与设备通信的核心工具
- **许可**：Android SDK License Agreement
- **来源**：<https://developer.android.com/tools/releases/platform-tools>
- **位置**：`resources/platform-tools/`

> ⚠️ **再分发注意**：Android SDK 的许可条款对再分发有额外约定。
> 若你计划公开分发包含 platform-tools 的安装包，请自行确认符合
> [Android SDK 许可](https://developer.android.com/studio/terms)的要求。
> 本项目的仓库**不包含**该目录，使用者需自行获取。

### Magisk

- **用途**：Root 方案（内置 APK）
- **许可**：GNU General Public License v3.0
- **来源**：<https://github.com/topjohnwu/Magisk>
- **位置**：`resources/apk/`

> **关于 GPL-3.0 与本项目 MIT 的关系**：本项目以**独立可执行文件**形式
> 随包分发未经修改的 Magisk APK，属于**聚合分发**（mere aggregation），
> 不构成衍生作品，因此不影响本项目采用 MIT 许可。
>
> 但若你**修改 Magisk 源码**并再分发，则修改部分必须按 GPL-3.0 开源。
> 本项目不修改 Magisk 源码，仅调用其公开接口。

### 驱动包

- **用途**：Android USB 驱动安装
- **许可**：各驱动厂商原始许可
- **位置**：`resources/drivers/`、`resources/bundled-tools/`
- **义务**：按各厂商原始条款使用，不得单独再分发。

### 固件模板（Tea templates）

- **用途**：镜像模板制作
- **位置**：`resources/tea-templates/`
- **说明**：本项目仅提供模板生成工具与脚本，不包含厂商固件本体。

---

## 构建与运行时依赖

| 组件 | 许可 | 用途 |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | 桌面运行时 |
| [electron-builder](https://www.electron.build/) | MIT | 打包工具（仅构建期） |
| [@phosphor-icons/web](https://phosphoricons.com/) | MIT | 界面图标 |

生产依赖（`package.json` 的 `dependencies`）经检查**仅含 MIT 许可组件**，
不含 GPL / AGPL / SSPL 等强 copyleft 许可。

可用以下命令复核：

```powershell
npm ls --omit=dev
npm audit --omit=dev
```

---

## 不包含的内容

以下内容**不纳入版本控制**，仓库中也没有它们的源码：

- 各厂商官方固件（ROM）本体
- Android SDK Platform Tools 二进制
- scrcpy 二进制
- Magisk APK
- 驱动安装包

`resources/` 目录整体被 `.gitignore` 排除。克隆仓库后需按
[`resources/MANIFEST.md`](resources/MANIFEST.md) 自行补齐。

---

## 商标声明

本项目为**非官方**社区工具，与 Google、Android、各手机厂商
（包括但不限于摩托罗拉、联想、小米、三星）**无隶属或背书关系**。

- Android 是 Google LLC 的商标
- Magisk 是 John Wu 的项目
- 其他商标归各自所有者所有

本项目名称与界面中出现的品牌名仅用于**说明兼容性**，属于描述性使用。

---

## 报告许可问题

如果你认为本项目不当使用了你的作品，请提交 Issue 并标注 `license`，
我们会尽快处理。
