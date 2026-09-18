[CmdletBinding()]
param(
  # 跳过打包（只做归档 + 安装，适合复用已有 dist 产物）
  [switch]$SkipBuild,
  # 跳过静默安装（只出包，不动本机已安装版本）
  [switch]$SkipInstall,
  # 跳过单窗口启动验证
  [switch]$SkipVerify,
  # 跳过完整 CI（只跑单元测试）；CI 包含语法检查、审计与资源校验
  [switch]$SkipCi,
  # 跳过 git 提交与打 tag
  [switch]$NoGit,
  # 不弹出记事本展示本次版本升级说明
  [switch]$NoNotes,
  # 归档目录，默认桌面 ADB搞机助手
  [string]$ArchiveDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ADB搞机助手')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$installerName = "ADB搞机助手_V${version}_安装包.exe"
$installer = Join-Path $root "dist\$installerName"
$distDir = Join-Path $root 'dist'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\adb-gaoji-assistant-next'
$installedExe = Join-Path $installRoot 'ADB搞机助手.exe'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'

function Stop-InstalledProcesses {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$installRoot\*" -or $_.Path -like "$root\node_modules\electron\*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Get-RunningInstances {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installRoot\*" })
}

# electron-builder 每次都会清空 dist/，因此必须在打包前把已有安装包抢救出来。
function Backup-DistInstallers {
  if (-not (Test-Path $distDir)) { return }
  $existing = @(Get-ChildItem $distDir -File -Filter '*安装包.exe' -ErrorAction SilentlyContinue)
  if (-not $existing.Count) { return }
  New-Item -ItemType Directory -Path $ArchiveDir -Force | Out-Null
  foreach ($file in $existing) {
    $target = Join-Path $ArchiveDir $file.Name
    if ((Test-Path $target) -and ((Get-Item $target).Length -eq $file.Length)) { continue }
    Copy-Item $file.FullName $target -Force
    $map = "$($file.FullName).blockmap"
    if (Test-Path $map) { Copy-Item $map (Join-Path $ArchiveDir (Split-Path $map -Leaf)) -Force }
    Write-Host "    rescued: $($file.Name)"
  }
}

$total = 8
$step = 0
function Step([string]$text) {
  $script:step += 1
  Write-Host "[$script:step/$total] $text"
}

# ---------------------------------------------------------------- 1. 前置检查
Step 'Preflight checks...'
$running = @(Get-RunningInstances)
if ($running.Count -and -not $SkipInstall) {
  Write-Host "    检测到 $($running.Count) 个正在运行的实例，安装阶段会将其关闭。"
}
if (-not (Test-Path $gitExe)) { Write-Host "    警告：未找到 git（$gitExe），将跳过版本提交。" }

# ------------------------------------------------------ 2. 归档既有 dist 产物
Step 'Rescuing existing installers from dist/ before build wipes it...'
Backup-DistInstallers
Write-Host "    归档目录：$ArchiveDir"

# ------------------------------------------------------------------ 3. 校验
# 跑完整 CI：语法检查、单元测试、7 项审计、资源完整性。
# 审计脚本报出的已知 P1 缺口不阻断发布，P0 会让 CI 以非零码退出。
if ($SkipCi) {
  Step 'CI skipped (-SkipCi); running tests only...'
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
} else {
  Step 'Running CI (checks, tests, audits, resources)...'
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'ci.ps1')
  if ($LASTEXITCODE -ne 0) { throw "CI failed with exit code $LASTEXITCODE" }
}

# ------------------------------------------------------------------ 4. 打包
if ($SkipBuild) {
  Step 'Build skipped (-SkipBuild).'
  if (-not (Test-Path $installer)) { throw "已跳过打包，但目标安装包不存在：$installer" }
} else {
  Step 'Building NSIS installer...'
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  & npx.cmd electron-builder --win nsis
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path $installer)) { throw "Installer was not created: $installer" }
}

# -------------------------------------------------------------- 5. 归档新产物
Step "Archiving $installerName to desktop..."
New-Item -ItemType Directory -Path $ArchiveDir -Force | Out-Null
Copy-Item $installer (Join-Path $ArchiveDir $installerName) -Force
$blockmap = "$installer.blockmap"
if (Test-Path $blockmap) { Copy-Item $blockmap (Join-Path $ArchiveDir (Split-Path $blockmap -Leaf)) -Force }
Write-Host "    $ArchiveDir\$installerName"

# ------------------------------------------------------------------ 6. 安装
if ($SkipInstall) {
  Step 'Install skipped (-SkipInstall).'
} else {
  Step "Installing $version..."
  Stop-InstalledProcesses
  Start-Sleep -Seconds 2
  $installResult = Start-Process -FilePath (Join-Path $ArchiveDir $installerName) -ArgumentList '/S' -Wait -PassThru
  if ($installResult.ExitCode -ne 0) { throw "Installer failed with exit code $($installResult.ExitCode)" }
  if (-not (Test-Path $installedExe)) { throw "Installed executable was not found: $installedExe" }
  $installedVersion = (Get-Item $installedExe).VersionInfo.FileVersion
  if ($installedVersion -ne $version) { throw "Installed version $installedVersion does not match $version" }
  Write-Host "    Installed version: $installedVersion"
}

# ------------------------------------------------------- 7. 验证 + git 收尾
Step 'Verifying single visible window...'
if ($SkipInstall -or $SkipVerify) {
  Write-Host '    跳过（-SkipInstall 或 -SkipVerify）。'
} elseif (-not (Test-Path $installedExe)) {
  Write-Host '    跳过：未安装。'
} else {
  try {
    $first = Start-Process -FilePath $installedExe -PassThru
    Start-Sleep -Seconds 4
    $second = Start-Process -FilePath $installedExe -PassThru
    Start-Sleep -Seconds 3
    $appProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe })
    $visibleWindows = @($appProcesses | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() })
    if ($visibleWindows.Count -ne 1) { throw "Expected one visible window, found $($visibleWindows.Count)" }
    Write-Host "    Visible windows: $($visibleWindows.Count)"
  } finally {
    Stop-InstalledProcesses
  }
}

if (-not $NoGit -and (Test-Path $gitExe)) {
  Write-Host "    git: 提交 v$version ..."
  Push-Location $root
  try {
    & $gitExe add -A 2>&1 | Out-Null
    $changed = & $gitExe status --porcelain 2>&1
    if ($changed) {
      & $gitExe commit -q -m "release: V$version" 2>&1 | Out-Null
      Write-Host "    已提交 V$version"
    } else {
      Write-Host '    工作区无变化，跳过提交'
    }
    $tagName = "v$version"
    $tagExists = & $gitExe tag -l $tagName 2>&1
    if (-not $tagExists) {
      & $gitExe tag -a $tagName -m "V$version" 2>&1 | Out-Null
      Write-Host "    已打 tag $tagName"
    } else {
      Write-Host "    tag $tagName 已存在"
    }
  } finally {
    Pop-Location
  }
}

# ------------------------------------------------- 8. 弹出版本升级说明
# 用记事本打开 VERSIONS.md，让本次发布升级了哪些内容一目了然。
# 只在真正完成了发布（建包或安装）后弹出；-NoNotes 可关闭。
Step 'Showing release notes (VERSIONS.md)...'
$notesPath = Join-Path $root 'VERSIONS.md'
if ($NoNotes) {
  Write-Host '    跳过（-NoNotes）。'
} elseif (-not (Test-Path $notesPath)) {
  Write-Host "    跳过：未找到 $notesPath"
} else {
  # 先把本次版本那一段提取成独立文件，打开后直接停在本次变更处，
  # 不用在长文档里自己翻。提取失败时退回打开完整文件。
  $releaseNote = Join-Path $root "dist\版本升级说明_V$version.txt"
  try {
    $lines = Get-Content $notesPath -Encoding UTF8
    $startIdx = -1
    $endIdx = $lines.Count
    for ($i = 0; $i -lt $lines.Count; $i += 1) {
      if ($lines[$i] -match "【\s*$([regex]::Escape($version))\s*】") { $startIdx = $i; continue }
      # 找到下一个版本段落的起始行，作为本次段落的结束
      if ($startIdx -ge 0 -and $lines[$i] -match '^\s*【') { $endIdx = $i; break }
    }
    New-Item -ItemType Directory -Path (Split-Path $releaseNote -Parent) -Force | Out-Null
    if ($startIdx -ge 0) {
      $header = @(
        "ADB搞机助手 V$version 版本升级说明",
        ("生成时间：" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
        ("安装包：" + (Join-Path $ArchiveDir $installerName)),
        '',
        '（完整历史版本记录见项目根目录 VERSIONS.md）',
        ('=' * 78),
        ''
      )
      # 段落标题上方保留一条分隔线，正文取到下一个版本之前
      $body = $lines[$startIdx..([Math]::Max($startIdx, $endIdx - 1))]
      $header + $body | Set-Content -Path $releaseNote -Encoding UTF8
      Write-Host "    已生成本次说明：$releaseNote"
    } else {
      Copy-Item $notesPath $releaseNote -Force
      Write-Host "    未匹配到 V$version 段落，改为打开完整记录。"
    }
  } catch {
    Write-Host "    生成本次说明失败（$($_.Exception.Message)），改为打开完整记录。"
    $releaseNote = $notesPath
  }

  # 用记事本打开，并等待用户关闭后继续（便于确认看到说明）
  $editor = Join-Path $env:SystemRoot 'System32\notepad.exe'
  if (Test-Path $editor) {
    Start-Process -FilePath $editor -ArgumentList "`"$releaseNote`"" | Out-Null
    Write-Host '    已用记事本打开版本升级说明。'
  } else {
    Start-Process -FilePath $releaseNote | Out-Null
    Write-Host '    已用系统默认程序打开版本升级说明。'
  }
}

Write-Host ''
Write-Host "Release V$version completed."
Write-Host "Installer: $(Join-Path $ArchiveDir $installerName)"
