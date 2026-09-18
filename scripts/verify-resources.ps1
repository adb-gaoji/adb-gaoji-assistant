# 校验 resources/ 运行时资源是否齐全
# 用法： pwsh -File scripts/verify-resources.ps1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root 'resources'

# 必须存在的关键文件（缺失则相关功能不可用）
$required = @{
  'platform-tools/adb.exe'                = '核心：所有 ADB 功能'
  'platform-tools/fastboot.exe'           = '核心：所有 Fastboot 功能'
  'platform-tools/AdbWinApi.dll'          = '核心：ADB 驱动接口'
  'apk/app-query-helper.apk'              = '应用管理'
  'apk/alpha.apk'                         = 'Magisk Root'
  'scrcpy/scrcpy-win64-v4.0/scrcpy.exe'   = '投屏'
  'drivers/一键安装安卓驱动.exe'              = '驱动安装'
  'gms/Google_Play_Store_51.3.25.apk'     = '谷歌商店'
  'tea-templates/android14-xt2241-eqs-boot-tea-10clones/boot_a_XT2241_Android14_Tea_10clones_verified.img' = 'Tea 引导模板'
}

$missing = @()
$present = 0

Write-Host '=== resources 完整性校验 ==='
Write-Host "根目录：$res"
Write-Host ''

foreach ($rel in ($required.Keys | Sort-Object)) {
  $full = Join-Path $res ($rel -replace '/', '\')
  if (Test-Path $full) {
    $mb = [math]::Round((Get-Item $full).Length / 1MB, 1)
    Write-Host ("  [OK]   {0,-70} {1,8} MB" -f $rel, $mb)
    $present += 1
  } else {
    Write-Host ("  [MISS] {0,-70} {1}" -f $rel, $required[$rel])
    $missing += $rel
  }
}

Write-Host ''
$sizes = @{}
foreach ($d in @('tea-templates', 'gms', 'bundled-tools', 'scrcpy', 'drivers', 'apk', 'platform-tools')) {
  $dir = Join-Path $res $d
  if (Test-Path $dir) {
    $sum = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    $sizes[$d] = [math]::Round($sum / 1MB, 1)
  } else {
    $sizes[$d] = $null
  }
}

Write-Host '=== 各资源目录体积 ==='
foreach ($d in ($sizes.Keys | Sort-Object)) {
  if ($null -eq $sizes[$d]) { Write-Host ("  {0,-20} 缺失" -f $d) }
  else { Write-Host ("  {0,-20} {1,8} MB" -f $d, $sizes[$d]) }
}

$totalMb = (Get-ChildItem $res -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("  {0,-20} {1,8:N1} MB" -f '合计', $totalMb)

Write-Host ''
if ($missing.Count) {
  Write-Host "结果：缺少 $missing.Count 项关键资源，相关功能将不可用。"
  Write-Host '缺少清单：'
  $missing | ForEach-Object { Write-Host "  - $_" }
  Write-Host ''
  Write-Host '对照 resources/MANIFEST.md 补齐后重试。'
  exit 1
}
Write-Host "结果：$present 项关键资源全部就位。"
exit 0
