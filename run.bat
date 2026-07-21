@echo off
setlocal
cd /d "%~dp0"

call :RefreshNodePath

call :EnsureNode
if errorlevel 1 exit /b 1

if not exist "node_modules\" (
  echo.
  echo Installing npm packages...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

echo.
echo Starting E-Guitar 60min Timer...
echo Press Ctrl+C to stop.
echo.

call npm.cmd run dev -- --host --open

pause
exit /b 0

:RefreshNodePath
if exist "%ProgramFiles%\nodejs\" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
exit /b 0

:EnsureNode
call :RefreshNodePath
where node >nul 2>&1
if not errorlevel 1 (
  echo Node.js:
  node -v
  exit /b 0
)

echo.
echo ========================================
echo  Node.js not found.
echo  Installing Node.js LTS via winget...
echo  Admin approval may be required.
echo ========================================
echo.

where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] winget is not available.
  echo Install Node.js manually: https://nodejs.org
  pause
  exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js auto-install failed.
  echo Install from https://nodejs.org then run run.bat again.
  pause
  exit /b 1
)

call :RefreshNodePath

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js installed but PATH not updated yet.
  echo Close this window and run run.bat again.
  pause
  exit /b 1
)

echo.
echo Node.js installed:
node -v
npm.cmd -v
echo.
exit /b 0
