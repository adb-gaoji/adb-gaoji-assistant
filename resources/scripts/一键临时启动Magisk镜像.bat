@echo off
chcp 65001>nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo.
echo 正在检查 fastboot...
fastboot.exe --version
if errorlevel 1 (
  echo.
  echo fastboot 无法启动，可能被安全软件拦截。
  pause
  exit /b 1
)

set "img_file="
set "img_count=0"
for %%F in (*.img) do (
  set /a img_count+=1
  set "img_file=%%F"
)

if "%img_count%"=="0" (
  echo.
  echo 当前目录没有找到 .img 镜像文件。
  echo 目录：%CD%
  pause
  exit /b 1
)

if not "%img_count%"=="1" (
  echo.
  echo 当前目录找到多个 .img 文件，为了避免启动错镜像，已停止。
  echo.
  dir /b *.img
  echo.
  echo 请只保留要启动的那个 .img 文件，或把其他 .img 移到别处。
  pause
  exit /b 1
)

echo.
echo 已选择镜像：%img_file%
echo.
echo 正在检查 fastboot 设备...
fastboot.exe devices -l
if errorlevel 1 (
  echo.
  echo 没有检测到 fastboot 设备。请确认手机已进入 bootloader/fastboot 模式。
  pause
  exit /b 1
)

echo.
echo 即将执行：fastboot boot "%img_file%"
echo.
fastboot.exe boot "%img_file%"
echo.
echo 命令已结束，退出码：%ERRORLEVEL%
pause
