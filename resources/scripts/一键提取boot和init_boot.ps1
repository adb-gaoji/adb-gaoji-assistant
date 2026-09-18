param(
    [switch]$Preview
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Base = Split-Path -Parent $MyInvocation.MyCommand.Path
$Adb = Join-Path $Base 'bin\adb.exe'
$Fastboot = Join-Path $Base 'bin\fastboot.exe'
$Desktop = [Environment]::GetFolderPath('Desktop')
$BootDir = Join-Path $Desktop 'boot'
$InitBootDir = Join-Path $Desktop 'init_boot'
$TmpDir = '/sdcard/codex_boot_extract'

function Invoke-Capture {
    param(
        [string]$File,
        [string[]]$ArgList = @()
    )

    if (-not (Test-Path -LiteralPath $File)) {
        return [pscustomobject]@{ Code = 9009; Text = "找不到文件：$File" }
    }

    $text = (& $File @ArgList 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    return [pscustomobject]@{ Code = $code; Text = $text }
}

function Pause-Step {
    Write-Host ''
    Read-Host '按回车继续' | Out-Null
}

function Get-ToolVersion {
    param([string]$File, [string[]]$ToolArgs)
    $result = Invoke-Capture $File $ToolArgs
    if ($result.Code -ne 0 -or [string]::IsNullOrWhiteSpace($result.Text)) {
        return '不可用'
    }
    return ($result.Text -split "`r?`n" | Select-Object -First 2) -join ' / '
}

function Get-AdbRows {
    $result = Invoke-Capture $Adb @('devices', '-l')
    $rows = @()
    foreach ($line in ($result.Text -split "`r?`n")) {
        if ($line -match '^\s*$' -or $line -match '^List of devices') { continue }
        $parts = $line -split '\s+', 3
        if ($parts.Count -ge 2) {
            $rows += [pscustomobject]@{
                Serial = $parts[0]
                State = $parts[1]
                Detail = if ($parts.Count -ge 3) { $parts[2] } else { '' }
            }
        }
    }
    return $rows
}

function Get-FastbootRows {
    $result = Invoke-Capture $Fastboot @('devices', '-l')
    $rows = @()
    foreach ($line in ($result.Text -split "`r?`n")) {
        if ($line -match '^\s*$') { continue }
        $parts = $line -split '\s+', 3
        if ($parts.Count -ge 1) {
            $rows += [pscustomobject]@{
                Serial = $parts[0]
                State = 'fastboot'
                Detail = if ($parts.Count -ge 3) { $parts[2] } else { '' }
            }
        }
    }
    return $rows
}

function Get-AdbValue {
    param([string]$Command)
    $result = Invoke-Capture $Adb @('shell', $Command)
    if ($result.Code -ne 0) { return '' }
    return (($result.Text -split "`r?`n" | Select-Object -First 1).Trim())
}

function Test-Root {
    $result = Invoke-Capture $Adb @('shell', 'su', '-c', 'id')
    if ($result.Code -eq 0 -and $result.Text -match 'uid=0') {
        return [pscustomobject]@{ Ok = $true; Text = $result.Text }
    }
    return [pscustomobject]@{ Ok = $false; Text = $result.Text }
}

function Test-Magisk {
    $adbRows = Get-AdbRows
    if (-not ($adbRows | Where-Object State -eq 'device')) {
        return [pscustomobject]@{ State = '未知'; Detail = '需要先进入系统并完成 USB 调试授权' }
    }

    $packages = Invoke-Capture $Adb @('shell', 'pm', 'list', 'packages')
    $packageHit = (($packages.Text -split "`r?`n") | Where-Object { $_ -match 'magisk|topjohnwu|kitsune' }) -join ', '

    $magiskCli = Invoke-Capture $Adb @('shell', 'su', '-c', 'magisk -v')
    if ($magiskCli.Code -eq 0 -and -not [string]::IsNullOrWhiteSpace($magiskCli.Text)) {
        $detail = "命令可用：$($magiskCli.Text)"
        if ($packageHit) { $detail = "$detail；应用：$packageHit" }
        return [pscustomobject]@{ State = '已检测到'; Detail = $detail }
    }

    if ($packageHit) {
        return [pscustomobject]@{ State = '疑似已安装'; Detail = "应用：$packageHit；尚未确认 su/magisk 命令" }
    }

    return [pscustomobject]@{ State = '未检测到'; Detail = '如果隐藏了面具应用，拿到 root 后仍可能通过 magisk 命令检测到' }
}

function Get-CurrentSlot {
    $fastbootRows = Get-FastbootRows
    if ($fastbootRows.Count -gt 0) {
        $result = Invoke-Capture $Fastboot @('getvar', 'current-slot')
        if ($result.Text -match 'current-slot:\s*([ab])') { return $Matches[1] }
    }

    $adbRows = Get-AdbRows
    if ($adbRows | Where-Object State -eq 'device') {
        $slot = Get-AdbValue 'getprop ro.boot.slot_suffix'
        if ($slot -match '_?([ab])') { return $Matches[1] }
    }

    return '未知'
}

function Get-Status {
    $adbRows = Get-AdbRows
    $fastbootRows = Get-FastbootRows
    $adbReady = $adbRows | Where-Object State -eq 'device'
    $adbUnauthorized = $adbRows | Where-Object State -eq 'unauthorized'
    $root = if ($adbReady) { Test-Root } else { [pscustomobject]@{ Ok = $false; Text = '' } }
    $magisk = Test-Magisk
    $slot = Get-CurrentSlot

    if ($fastbootRows.Count -gt 0) {
        $mode = 'Fastboot'
        $device = ($fastbootRows | ForEach-Object { "$($_.Serial) $($_.State)" }) -join '; '
    } elseif ($adbReady) {
        $mode = 'ADB'
        $device = ($adbReady | ForEach-Object { "$($_.Serial) $($_.Detail)" }) -join '; '
    } elseif ($adbUnauthorized) {
        $mode = 'ADB未授权'
        $device = ($adbUnauthorized | ForEach-Object { $_.Serial }) -join '; '
    } else {
        $mode = '未连接'
        $device = '未检测到 ADB 或 fastboot 设备'
    }

    if ($root.Ok) {
        $rootState = '已授权'
    } else {
        $rootState = '未确认'
    }

    return [pscustomobject]@{
        Mode = $mode
        Device = $device
        Root = $rootState
        RootDetail = $root.Text
        Magisk = $magisk.State
        MagiskDetail = $magisk.Detail
        Slot = $slot
        AdbRows = $adbRows
        FastbootRows = $fastbootRows
    }
}

function Write-StatusTable {
    if (-not $Preview) {
        try { Clear-Host } catch { Write-Host '' }
    }
    $status = Get-Status
    Write-Host '╔════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '║              boot / init_boot 修补助手                    ║' -ForegroundColor Cyan
    Write-Host '╚════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '【当前状态】' -ForegroundColor Yellow

    $adbState = '缺失'
    if (Test-Path -LiteralPath $Adb) { $adbState = '可用' }
    $fastbootState = '缺失'
    if (Test-Path -LiteralPath $Fastboot) { $fastbootState = '可用' }
    $rootLine = (($status.RootDetail -split "`r?`n" | Select-Object -First 1) -join '')

    Write-StatusRow 'ADB工具' $adbState (Get-ToolVersion $Adb @('version'))
    Write-StatusRow 'Fastboot工具' $fastbootState (Get-ToolVersion $Fastboot @('--version'))
    Write-StatusRow '手机模式' $status.Mode $status.Device
    Write-StatusRow '面具/Magisk' $status.Magisk $status.MagiskDetail
    Write-StatusRow 'Root/su' $status.Root $rootLine
    Write-StatusRow '当前槽位' $status.Slot '修补时优先选当前槽位对应文件'
    Write-StatusRow 'boot输出' '桌面' $BootDir
    Write-StatusRow 'init_boot输出' '桌面' $InitBootDir
    Write-Host ''
    Write-Host '【推荐下一步】' -ForegroundColor Yellow
    Write-Host ('  ' + (Get-NextHint $status)) -ForegroundColor Green
    Write-Host ''
    return $status
}

function Get-StateColor {
    param([string]$State)
    switch -Regex ($State) {
        '已|可用|ADB$|Fastboot|桌面|[ab]' { return 'Green' }
        '未|缺失|不可用|未知|失败' { return 'Red' }
        '疑似|未授权|未确认' { return 'Yellow' }
        default { return 'White' }
    }
}

function Write-StatusRow {
    param(
        [string]$Name,
        [string]$State,
        [string]$Detail
    )
    Write-Host ('  {0,-14} ' -f $Name) -NoNewline -ForegroundColor DarkGray
    Write-Host ('{0,-12}' -f $State) -NoNewline -ForegroundColor (Get-StateColor $State)
    if ([string]::IsNullOrWhiteSpace($Detail)) { $Detail = '-' }
    if ($Detail.Length -gt 82) { $Detail = $Detail.Substring(0, 79) + '...' }
    Write-Host " $Detail" -ForegroundColor Gray
}

function Get-NextHint {
    param($Status)
    if ($Status.Mode -eq 'Fastboot') {
        return '手机在 fastboot。要提取分区请选 A 自动流程，脚本会先提示重启到系统。'
    }
    if ($Status.Mode -eq '未连接') {
        return '连接手机，开机后打开 USB 调试；连接好后选 2 等待授权。'
    }
    if ($Status.Mode -eq 'ADB未授权') {
        return '看手机屏幕，允许 USB 调试授权，然后选 2 重试。'
    }
    if ($Status.Magisk -eq '未检测到') {
        return '先确认面具/Magisk 是否安装；可选 4 安装 APK，或选 A 继续检测 root。'
    }
    if ($Status.Root -ne '已授权') {
        return '下一步需要 root。选 5 检查 root，并在手机上允许 Shell/ADB 授权。'
    }
    return '环境基本就绪。选 A 全自动或选 6 直接提取 boot/init_boot。'
}

function Wait-AdbAuthorized {
    while ($true) {
        Invoke-Capture $Adb @('start-server') | Out-Null
        $rows = Get-AdbRows
        if ($rows | Where-Object State -eq 'device') {
            Write-Host 'ADB 已授权。'
            return $true
        }
        Write-Host ''
        if ($rows | Where-Object State -eq 'unauthorized') {
            Write-Host '手机已经连接，但还没有授权。请看手机屏幕，允许 USB 调试。'
        } else {
            Write-Host '还没有检测到 ADB 设备。请确认手机已开机、USB 调试已开启、数据线正常。'
        }
        $choice = Read-Host '授权/连接好后输入 R 重试，输入 Q 返回菜单'
        if ($choice -match '^(q|Q)$') { return $false }
    }
}

function Ensure-SystemMode {
    $fastbootRows = Get-FastbootRows
    if ($fastbootRows.Count -gt 0) {
        Write-Host '当前手机在 fastboot 模式，提取分区需要先进系统。'
        $choice = Read-Host '输入 Y 自动重启到系统，其他键取消'
        if ($choice -notmatch '^(y|Y)$') { return $false }
        Invoke-Capture $Fastboot @('reboot') | Out-Null
        Write-Host '已发送重启命令。等手机完全开机，并在弹窗中允许 USB 调试。'
        Pause-Step
    }
    return (Wait-AdbAuthorized)
}

function Ensure-Root {
    Write-Host ''
    Write-Host '正在检查 root/su 权限。手机可能会弹出面具/Superuser 授权，请点允许。'
    $root = Test-Root
    if ($root.Ok) {
        Write-Host "root 正常：$($root.Text)"
        return $true
    }
    Write-Host '没有拿到 su 权限，无法直接读取 boot/init_boot 分区。'
    Write-Host '请确认已安装面具/Magisk 并允许 Shell/ADB 的超级用户权限。'
    Write-Host $root.Text
    return $false
}

function Get-PartitionPath {
    param([string]$Part)
    $cmd = "for d in /dev/block/by-name /dev/block/bootdevice/by-name /dev/block/platform/*/by-name; do if [ -e `"`$d/$Part`" ]; then echo `"`$d/$Part`"; exit 0; fi; done; exit 1"
    $result = Invoke-Capture $Adb @('shell', 'su', '-c', $cmd)
    if ($result.Code -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Text)) {
        return (($result.Text -split "`r?`n" | Select-Object -First 1).Trim())
    }
    return ''
}

function Extract-OnePartition {
    param(
        [string]$Part,
        [string]$OutDir
    )

    Write-Host ''
    Write-Host "正在查找 $Part ..."
    $partPath = Get-PartitionPath $Part
    if (-not $partPath) {
        Write-Host "  跳过：未找到 $Part"
        return $false
    }

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    Invoke-Capture $Adb @('shell', "mkdir -p $TmpDir") | Out-Null

    $remote = "$TmpDir/$Part.img"
    $local = Join-Path $OutDir "$Part.img"
    Write-Host "  找到：$partPath"
    Write-Host '  正在读取分区到手机临时目录...'
    $dd = Invoke-Capture $Adb @('shell', 'su', '-c', "dd if=$partPath of=$remote bs=4096")
    Write-Host $dd.Text
    if ($dd.Code -ne 0) {
        Write-Host "  失败：读取 $Part 失败"
        return $false
    }

    Write-Host "  正在复制到电脑：$local"
    $pull = Invoke-Capture $Adb @('pull', $remote, $local)
    Write-Host $pull.Text
    Invoke-Capture $Adb @('shell', 'rm', '-f', $remote) | Out-Null
    if ($pull.Code -ne 0) {
        Write-Host "  失败：拉取 $Part 失败"
        return $false
    }

    Write-Host "  完成：$local"
    return $true
}

function Extract-BootImages {
    if (-not (Ensure-SystemMode)) { return }
    if (-not (Ensure-Root)) { Pause-Step; return }

    $foundBoot = $false
    $foundInit = $false
    foreach ($part in @('boot_a', 'boot_b')) {
        if (Extract-OnePartition $part $BootDir) { $foundBoot = $true }
    }
    foreach ($part in @('init_boot_a', 'init_boot_b')) {
        if (Extract-OnePartition $part $InitBootDir) { $foundInit = $true }
    }

    Write-Host ''
    Write-Host '============================================================'
    Write-Host '提取结果'
    Write-Host '============================================================'
    if ($foundBoot) {
        Write-Host "boot 输出：$BootDir"
        Get-ChildItem -LiteralPath $BootDir -Filter '*.img' | ForEach-Object { Write-Host "  $($_.Name)" }
    } else {
        Write-Host '未提取到 boot_a / boot_b。'
    }
    if ($foundInit) {
        Write-Host "init_boot 输出：$InitBootDir"
        Get-ChildItem -LiteralPath $InitBootDir -Filter '*.img' | ForEach-Object { Write-Host "  $($_.Name)" }
    } else {
        Write-Host '未提取到 init_boot_a / init_boot_b。'
    }
    Write-Host ''
    Write-Host '下一步：用面具/Magisk 选择并修补当前槽位对应的 boot 或 init_boot 文件。'
    Pause-Step
}

function Install-MagiskApk {
    if (-not (Ensure-SystemMode)) { return }
    $apks = @()
    foreach ($dir in @($Base, (Join-Path $Base '安装包'))) {
        if (Test-Path -LiteralPath $dir) {
            $apks += Get-ChildItem -LiteralPath $dir -Filter '*.apk' -File -ErrorAction SilentlyContinue
        }
    }
    if ($apks.Count -eq 0) {
        Write-Host '没有在当前工具目录或“安装包”目录里找到 APK。'
        Pause-Step
        return
    }

    Write-Host ''
    Write-Host '可安装的 APK：'
    for ($i = 0; $i -lt $apks.Count; $i++) {
        Write-Host ("[{0}] {1}" -f ($i + 1), $apks[$i].FullName)
    }
    $pick = Read-Host '输入编号安装，或直接回车取消'
    if ($pick -notmatch '^\d+$') { return }
    $index = [int]$pick - 1
    if ($index -lt 0 -or $index -ge $apks.Count) { return }

    Write-Host "正在安装：$($apks[$index].Name)"
    $result = Invoke-Capture $Adb @('install', '-r', $apks[$index].FullName)
    Write-Host $result.Text
    Pause-Step
}

function Reboot-Fastboot {
    $rows = Get-AdbRows
    if ($rows | Where-Object State -eq 'device') {
        Invoke-Capture $Adb @('reboot', 'bootloader') | Out-Null
        Write-Host '已发送重启到 fastboot/bootloader 命令。'
    } else {
        Write-Host '当前没有 ADB 已授权设备，无法自动重启。'
    }
    Pause-Step
}

function Show-CurrentSlot {
    $slot = Get-CurrentSlot
    Write-Host "当前槽位：$slot"
    Pause-Step
}

function Boot-PatchedImage {
    $fastbootRows = Get-FastbootRows
    if ($fastbootRows.Count -eq 0) {
        Write-Host '没有检测到 fastboot 设备。请先进入 bootloader/fastboot。'
        Pause-Step
        return
    }

    $bin = Join-Path $Base 'bin'
    $imgs = Get-ChildItem -LiteralPath $bin -Filter '*.img' -File -ErrorAction SilentlyContinue
    if ($imgs.Count -eq 0) {
        Write-Host "没有在 $bin 找到 .img 文件。"
        Pause-Step
        return
    }

    if ($imgs.Count -eq 1) {
        $img = $imgs[0]
    } else {
        Write-Host '发现多个 .img 文件：'
        for ($i = 0; $i -lt $imgs.Count; $i++) {
            Write-Host ("[{0}] {1}" -f ($i + 1), $imgs[$i].Name)
        }
        $pick = Read-Host '输入要临时启动的编号，或回车取消'
        if ($pick -notmatch '^\d+$') { return }
        $index = [int]$pick - 1
        if ($index -lt 0 -or $index -ge $imgs.Count) { return }
        $img = $imgs[$index]
    }

    Write-Host "即将执行：fastboot boot `"$($img.Name)`""
    $ok = Read-Host '确认执行请输入 Y'
    if ($ok -notmatch '^(y|Y)$') { return }
    $result = Invoke-Capture $Fastboot @('boot', $img.FullName)
    Write-Host $result.Text
    Write-Host "退出码：$($result.Code)"
    Pause-Step
}

function Open-OutputFolders {
    New-Item -ItemType Directory -Force -Path $BootDir, $InitBootDir | Out-Null
    Start-Process explorer.exe $BootDir
    Start-Process explorer.exe $InitBootDir
}

function Auto-Flow {
    Write-Host ''
    Write-Host '自动流程：检测面具/Magisk -> 授权 -> root -> 提取 -> 下一步'
    Pause-Step
    if (-not (Ensure-SystemMode)) { return }

    $magisk = Test-Magisk
    Write-Host "面具/Magisk：$($magisk.State) - $($magisk.Detail)"
    if ($magisk.State -eq '未检测到') {
        Write-Host '未检测到面具。你可以返回菜单选择“安装 APK”，或先在手机上安装/打开面具。'
        $choice = Read-Host '继续尝试 root 检测请输入 Y，其他键返回菜单'
        if ($choice -notmatch '^(y|Y)$') { return }
    }

    if (-not (Ensure-Root)) { Pause-Step; return }
    Extract-BootImages
}

if ($Preview) {
    Write-StatusTable | Out-Null
    Write-Host '【自动操作】' -ForegroundColor Yellow
    Write-Host '  A   全自动：检测面具 -> 等待授权 -> 检查 root -> 提取分区' -ForegroundColor Green
    Write-Host ''
    Write-Host '【手动步骤】' -ForegroundColor Yellow
    Write-Host '  1   刷新状态表'
    Write-Host '  2   等待/重试 ADB 授权'
    Write-Host '  3   检测面具/Magisk'
    Write-Host '  4   安装 APK 到手机'
    Write-Host '  5   检查 root/su 权限'
    Write-Host '  6   提取 boot_a/b 和 init_boot_a/b'
    Write-Host ''
    Write-Host '【开机/修补辅助】' -ForegroundColor Yellow
    Write-Host '  7   重启到 fastboot/bootloader'
    Write-Host '  8   查看当前槽位'
    Write-Host '  9   临时启动 bin 目录里的修补镜像'
    Write-Host '  O   打开输出文件夹'
    Write-Host '  Q   退出'
    exit 0
}

while ($true) {
    $status = Write-StatusTable
    Write-Host '【自动操作】' -ForegroundColor Yellow
    Write-Host '  A   全自动：检测面具 -> 等待授权 -> 检查 root -> 提取分区' -ForegroundColor Green
    Write-Host ''
    Write-Host '【手动步骤】' -ForegroundColor Yellow
    Write-Host '  1   刷新状态表' -ForegroundColor White
    Write-Host '  2   等待/重试 ADB 授权' -ForegroundColor White
    Write-Host '  3   检测面具/Magisk' -ForegroundColor White
    Write-Host '  4   安装 APK 到手机' -ForegroundColor White
    Write-Host '  5   检查 root/su 权限' -ForegroundColor White
    Write-Host '  6   提取 boot_a/b 和 init_boot_a/b' -ForegroundColor White
    Write-Host ''
    Write-Host '【开机/修补辅助】' -ForegroundColor Yellow
    Write-Host '  7   重启到 fastboot/bootloader' -ForegroundColor White
    Write-Host '  8   查看当前槽位' -ForegroundColor White
    Write-Host '  9   临时启动 bin 目录里的修补镜像' -ForegroundColor White
    Write-Host '  O   打开输出文件夹' -ForegroundColor White
    Write-Host '  Q   退出' -ForegroundColor DarkGray
    Write-Host ''
    $choice = Read-Host '请选择功能'

    switch -Regex ($choice) {
        '^(a|A)$' { Auto-Flow }
        '^1$' { continue }
        '^2$' { Wait-AdbAuthorized | Out-Null; Pause-Step }
        '^3$' { $m = Test-Magisk; Write-Host "面具/Magisk：$($m.State) - $($m.Detail)"; Pause-Step }
        '^4$' { Install-MagiskApk }
        '^5$' { if (Ensure-SystemMode) { Ensure-Root | Out-Null }; Pause-Step }
        '^6$' { Extract-BootImages }
        '^7$' { Reboot-Fastboot }
        '^8$' { Show-CurrentSlot }
        '^9$' { Boot-PatchedImage }
        '^(o|O)$' { Open-OutputFolders }
        '^(q|Q)$' { break }
        default { Write-Host '无效选择。'; Start-Sleep -Seconds 1 }
    }
}
