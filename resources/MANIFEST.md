# resources/ 运行时资源清单

本目录存放随安装包一起分发的**大体积二进制资源**。这些文件合计约 **893.7 MB**，
不适合纳入 Git 版本控制，因此已由仓库根目录 `.gitignore` 排除。

> **克隆仓库后必须补齐本目录**，否则程序的相关功能不可用（打包也会缺文件）。
> 校验方式：`pwsh scripts/verify-resources.ps1`
>
> **注意**：这些资源在早期版本中曾被 Git 跟踪，导致 `.gitignore` 对其无效。
> 现已全部移出版本控制，仓库体积从 456 MB 降至约 273 KB。
> 旧备份（含原始 B 槽镜像与旧仓库历史）保留在 `（本机备份目录，未纳入版本控制）`。

---

## 一、被排除的目录

| 目录 | 体积 | 文件数 | 用途 | 缺失影响 |
|---|---|---|---|---|
| `tea-templates/` | 480 MB | 7 | Tea 引导镜像模板（5 套，A/B 槽位已合并） | 「Tea 引导」制作功能不可用 |
| `gms/` | 214.9 MB | 3 | 谷歌三件套内置安装包 | 「安装谷歌三件套」不可用 |
| `bundled-tools/` | 117 MB | 8 | QPST / FreeControl / 驱动安装器等第三方工具 | 「9008 救砖」「工具箱」不可用 |
| `scrcpy/` | 39.8 MB | 15 | scrcpy 4.0 投屏 | 「投屏」功能不可用 |
| `drivers/` | 23 MB | 2 | 安卓 USB 驱动 + VC++ 运行时 | 「安装驱动」不可用 |
| `apk/` | 11.1 MB | 2 | Magisk alpha + 应用查询助手 | Root / 应用管理不可用 |
| `platform-tools/` | 7.8 MB | 5 | adb / fastboot | **核心功能全不可用** |

## 二、入库的小体积资源

以下资源体积小、随源码一起提交：

| 路径 | 用途 |
|---|---|
| `icons/app.ico` | 应用图标 |
| `scripts/` | 随包脚本 |

---

## 三、关键文件校验值（SHA256 前 16 位）

用于确认资源是否被替换或损坏。

### platform-tools/（核心，必须存在）
| 文件 | 大小 | SHA256 |
|---|---|---|
| `adb.exe` | 5.7 MB | `0E606318957BAAC8` |
| `fastboot.exe` | 1.7 MB | `7277F971C67F5A60` |
| `AdbWinApi.dll` | 0.1 MB | `1AD523231DE449AF` |
| `libwinpthread-1.dll` | 0.2 MB | `8E20F1E118135BB7` |

### gms/
| 文件 | 大小 | SHA256 |
|---|---|---|
| `Google_Play_services_26.18.33.apks` | 111.9 MB | `9BFBEDC4AC5649DE` |
| `Google_Play_Store_51.3.25.apk` | 96.0 MB | `881E80DAE0F88CEF` |
| `Google_Services_Framework_12-7567768.apk` | 7.1 MB | `DD69B04B98D9B086` |

### apk/
| 文件 | 大小 | SHA256 |
|---|---|---|
| `alpha.apk` | 11.0 MB | `E3CD39E1B8CEF250` |
| `app-query-helper.apk` | < 0.1 MB | `28CC1E0965ADBF00` |

### scrcpy/scrcpy-win64-v4.0/
| 文件 | 大小 | SHA256 |
|---|---|---|
| `scrcpy.exe` | — | （见 `scrcpy --version`） |
| `SDL3.dll` | 21.8 MB | `F8BB1698F6189494` |
| `adb.exe` | 8.1 MB | `957E46B8615F7AF5` |
| `avcodec-62.dll` | 6.3 MB | `893237890F744EA1` |
| `avutil-60.dll` | 1.0 MB | `2933C61BD5C3F0C2` |

### drivers/
| 文件 | 大小 | SHA256 |
|---|---|---|
| `一键安装安卓驱动.exe` | 20.4 MB | `0BA0F9CB19B4F762` |
| `vc/Microsoft Visual C++ 2005 x86.exe` | 2.6 MB | `1305A2028ADDB7AA` |

### bundled-tools/
| 文件 | 大小 | SHA256 |
|---|---|---|
| `QPST.2.7.496.zip` | 40.1 MB | `A96187427241EA6D` |
| `FreeControl.exe` | 27.5 MB | `1685E630C775557E` |
| `安装ADB驱动.exe` | 19.7 MB | `15077CB5F5F37071` |
| `爱玩机工具箱_S-22.0.9.7.apk` | 9.8 MB | `2294F49D304986C9` |

### tea-templates/
| 目录 | 内容 | 大小 |
|---|---|---|
| `android11-s30/` | `boot_a_*.img` | 96 MB |
| `android12-s30-init_boot/` | `init_boot_a_*.img` | 96 MB |
| `android13-x30pro-init_boot-reference/` | `init_boot_a_*.img` | 96 MB |
| `android13-xt2241-eqs-boot-tea-product/` | `boot_a_*.img` | 96 MB |
| `android14-xt2241-eqs-boot-tea-10clones/` | `boot_a_*.img` | 96 MB |

> **A/B 槽位已合并**：每个模板原先同时存放 `_a_` 与 `_b_` 两份镜像，
> 实测两者 SHA256 完全一致（例：`android14-...-10clones` 的 A/B 均为 `5BEABD92838C3D6F`），
> 属于纯冗余。现每个模板只保留一份物理镜像，
> `manifest.json` 中 `files[0]` 与 `files[1]` 指向同一文件，
> 界面仍可选择「槽位 A / 槽位 B」，生成的镜像内容本就相同。
> 该项优化释放 **480 MB**（960 MB → 480 MB），安装包体积同步下降约 240 MB（压缩后）。
>
> 原始的 B 槽镜像与 manifest 备份在 `%USERPROFILE%\Desktop\ADB搞机助手-tea备份\`。

---

## 四、占用优化记录

- **2026-09-14**：合并 tea-templates 的 A/B 槽位冗余镜像，释放 480 MB。
  各模板 `sha256` 校验值未变，Tea 制作流程哈希校验仍然通过。
