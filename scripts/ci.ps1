#Requires -Version 5.1
<#
.SYNOPSIS
    ADB搞机助手 本地持续集成。

.DESCRIPTION
    依次执行语法检查、单元测试、各项审计与资源校验，任一环节失败即以非零码退出。
    release.ps1 的第一步会调用本脚本，因此发布前不会漏跑校验。

.PARAMETER SkipAudit
    跳过审计脚本（11 个 audit:*），只跑语法检查与单元测试，用于快速迭代。

.PARAMETER SkipResources
    跳过 resources/ 资源完整性校验（资源未就位时使用）。

.PARAMETER Quiet
    只输出摘要，不逐条打印每个步骤的细节。

.EXAMPLE
    pwsh -NoProfile -File scripts/ci.ps1
    pwsh -NoProfile -File scripts/ci.ps1 -SkipAudit
#>
[CmdletBinding()]
param(
  [switch]$SkipAudit,
  [switch]$SkipResources,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$script:failures = @()
$script:warnings = @()
$script:passed = 0

function Write-Step([string]$text) {
  if (-not $Quiet) { Write-Host $text }
}

function Invoke-Check {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Action,
    # 审计脚本用退出码表达严重度：2 = 存在 P0（必须修），1 = 存在 P1 已知缺口。
    # 打开 AllowPartial 时，退出码 1 记为警告而不判定 CI 失败。
    [switch]$AllowPartial
  )
  Write-Step "  > $Name"
  try {
    $output = & $Action 2>&1
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    if ($code -eq 0) {
      $script:passed += 1
      if (-not $Quiet) { Write-Host "    ok" -ForegroundColor DarkGray }
      return $true
    }
    if ($AllowPartial -and $code -eq 1) {
      $script:warnings += $Name
      Write-Host '    warn (存在未完成的 P1 项)' -ForegroundColor Yellow
      return $true
    }
    $script:failures += $Name
    Write-Host "    FAIL ($code)" -ForegroundColor Red
    $output | Select-Object -Last 15 | ForEach-Object { Write-Host "      $_" }
    return $false
  } catch {
    $script:failures += $Name
    Write-Host "    FAIL ($($_.Exception.Message))" -ForegroundColor Red
    return $false
  }
}

# 跑需要 Electron 的审计（目前只有对比度审计）。
# Electron 是 GUI 子系统程序：用 & 调用时 PowerShell 不会等待它结束，
# $LASTEXITCODE 取不到值，CI 会把「成功」误判为失败。
# Start-Process -Wait -PassThru 能可靠拿到退出码。
function Invoke-ElectronAudit {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$ScriptPath
  )
  Write-Step "  > $Name"
  $exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $exe)) {
    $script:failures += $Name
    Write-Host "    FAIL 未找到 Electron：$exe" -ForegroundColor Red
    return $false
  }
  if (-not (Test-Path $ScriptPath)) {
    $script:failures += $Name
    Write-Host "    FAIL 未找到审计脚本：$ScriptPath" -ForegroundColor Red
    return $false
  }
  try {
    $proc = Start-Process -FilePath $exe -ArgumentList $ScriptPath -Wait -PassThru -NoNewWindow
    $code = $proc.ExitCode
    if ($code -eq 0) {
      $script:passed += 1
      if (-not $Quiet) { Write-Host '    ok' -ForegroundColor DarkGray }
      return $true
    }
    if ($code -eq 1) {
      $script:warnings += $Name
      Write-Host '    warn (存在未完成的 P1 项)' -ForegroundColor Yellow
      return $true
    }
    $script:failures += $Name
    Write-Host "    FAIL ($code)" -ForegroundColor Red
    return $false
  } catch {
    $script:failures += $Name
    Write-Host "    FAIL ($($_.Exception.Message))" -ForegroundColor Red
    return $false
  }
}

Write-Host 'ADB搞机助手 CI'
Write-Host ('-' * 46)

# ---------------------------------------------------------------- 语法检查
Write-Host '[1/5] 语法检查'
$sources = @(
  'src/main.js', 'src/preload.js', 'src/renderer.js',
  'src/action_handlers.js', 'src/app_package_query.js', 'src/device_reboot.js',
  'src/firmware-catalog.js', 'src/firmware_parser.js', 'src/adb_parser.js',
  'src/actions.registry.js'
)
$missing = @($sources | Where-Object { -not (Test-Path $_) })
if ($missing.Count) {
  $script:failures += 'sources-present'
  Write-Host "    FAIL 缺少源文件: $($missing -join ', ')" -ForegroundColor Red
} else {
  $script:passed += 1
  if (-not $Quiet) { Write-Host "    ok ($($sources.Count) 个文件)" -ForegroundColor DarkGray }
}

# 版本升级说明是发布流程的一部分：release.ps1 会弹出它，
# 若缺失或漏写当前版本段落，安装后就看不到本次升级内容。
$notesPath = Join-Path $PSScriptRoot '..\VERSIONS.md'
if (-not (Test-Path $notesPath)) {
  $script:failures += 'versions-notes'
  Write-Host '    FAIL 缺少 VERSIONS.md（版本升级说明）' -ForegroundColor Red
} else {
  $currentVersion = [string](Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $notesText = Get-Content $notesPath -Raw -Encoding UTF8
  if ($notesText -notmatch "【\s*$([regex]::Escape($currentVersion))\s*】") {
    $script:failures += 'versions-notes'
    Write-Host "    FAIL VERSIONS.md 中缺少当前版本 V$currentVersion 的段落" -ForegroundColor Red
  } else {
    $script:passed += 1
    if (-not $Quiet) { Write-Host "    ok (VERSIONS.md 含 V$currentVersion)" -ForegroundColor DarkGray }
  }
}

# ---------------------------------------------------------------- 单元测试
Write-Host '[2/5] 单元测试'
Invoke-Check -Name 'npm test' -Action { & npm.cmd test --silent } | Out-Null

# ------------------------------------------------------------ 生产依赖审计
# 只审计生产依赖：devDependencies（electron / electron-builder 及其构建期
# 传递依赖）不会进入安装包，其 tar 等漏洞属于构建工具链问题，另行跟踪。
Write-Host '[3/5] 生产依赖审计'
Invoke-Check -Name 'npm audit --omit=dev' -Action { & npm.cmd audit --omit=dev --audit-level=high } | Out-Null

# ---------------------------------------------------------------- 审计
if ($SkipAudit) {
  Write-Host '[4/5] 审计（已跳过）'
} else {
  Write-Host '[4/5] 审计'
  $audits = @(
    'audit:actions', 'audit:danger', 'audit:tasks', 'audit:ui-state',
    'audit:wireless-cast', 'audit:wireless-pair', 'audit:mirror-session',
    'audit:themes', 'audit:contrast', 'audit:links', 'audit:patterns'
  )
  foreach ($audit in $audits) {
    # 审计脚本把“已知但未修的 P1”作为退出码 1 报出；这类缺口已在 ROADMAP 中登记，
    # 不应阻断发布，但 P0（退出码 2）必须让 CI 失败。
    if ($audit -eq 'audit:contrast') {
      # 对比度审计跑在 Electron（GUI 子系统程序）里。PowerShell 用 & 调用 GUI 程序时
      # 不会等待其结束，$LASTEXITCODE 取不到值，会被误判为失败。
      # 因此改用 Start-Process -Wait 取真实退出码。
      Invoke-ElectronAudit -Name $audit -ScriptPath (Join-Path $PSScriptRoot 'audit-contrast.js') | Out-Null
    } else {
      Invoke-Check -Name $audit -Action { & npm.cmd run $audit --silent } -AllowPartial | Out-Null
    }
  }
}

# ---------------------------------------------------------------- 资源
if ($SkipResources) {
  Write-Host '[5/5] 资源校验（已跳过）'
} else {
  Write-Host '[5/5] 资源校验'
  $verify = Join-Path $PSScriptRoot 'verify-resources.ps1'
  if (Test-Path $verify) {
    Invoke-Check -Name 'verify-resources' -Action { & pwsh -NoProfile -File $verify } | Out-Null
  } else {
    Write-Host '    (未找到 verify-resources.ps1，跳过)' -ForegroundColor DarkYellow
  }
}

# ---------------------------------------------------------------- 摘要
Write-Host ('-' * 46)
if ($script:warnings.Count) {
  Write-Host "已知缺口（不阻断发布，见 ROADMAP.md）：" -ForegroundColor Yellow
  $script:warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
if ($script:failures.Count) {
  Write-Host "CI 失败：$($script:failures.Count) 项未通过" -ForegroundColor Red
  $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
$summary = "CI 通过：$($script:passed) 项成功"
if ($script:warnings.Count) { $summary += "，$($script:warnings.Count) 项已知缺口（不阻断发布）" }
Write-Host "$summary。" -ForegroundColor Green
exit 0
