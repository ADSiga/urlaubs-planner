@echo off
REM ============================================================================
REM Install the Urlaubs-Planer Next.js PRODUCTION server as a Windows service.
REM
REM Run this AS ADMINISTRATOR on 192.168.2.12.
REM
REM Prerequisites:
REM   * NSSM on PATH            -> choco install nssm   (or download from nssm.cc,
REM                                put win64\nssm.exe somewhere on PATH)
REM   * Node on PATH            -> the same node you run `next` with
REM   * `npm run build` already done in the app dir
REM   * STOP any manual `next start` first (it holds port 3000; the service can't
REM     bind it otherwise)
REM
REM Points the service at node.exe + Next's bin (NOT npx.cmd/npm.cmd, which are
REM batch wrappers and behave badly under the service manager).
REM ============================================================================
setlocal

set "SERVICE=UrlaubeApp"
set "APPDIR=C:\laragon\www\Kalender\kalender"
set "LOGDIR=C:\laragon\www\Kalender\logs"

where nssm >nul 2>&1 || (echo [ERROR] nssm not found on PATH. Install it first ^(choco install nssm^) and re-run.& exit /b 1)

set "NODEEXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODEEXE set "NODEEXE=%%i"
if not defined NODEEXE (echo [ERROR] node not found on PATH.& exit /b 1)
echo Using node: %NODEEXE%

set "NEXTBIN=%APPDIR%\node_modules\next\dist\bin\next"
if not exist "%NEXTBIN%" (echo [ERROR] Next CLI not found at "%NEXTBIN%". Run npm install / npm run build first.& exit /b 1)

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM Remove any prior instance so this script is idempotent.
nssm stop "%SERVICE%" >nul 2>&1
nssm remove "%SERVICE%" confirm >nul 2>&1

REM Application + arguments: bind to localhost so :3000 is reachable only via Apache.
nssm install "%SERVICE%" "%NODEEXE%" "%NEXTBIN%" start -H 127.0.0.1 -p 3000
nssm set "%SERVICE%" AppDirectory "%APPDIR%"
nssm set "%SERVICE%" AppEnvironmentExtra NODE_ENV=production
nssm set "%SERVICE%" AppStdout "%LOGDIR%\app-out.log"
nssm set "%SERVICE%" AppStderr "%LOGDIR%\app-err.log"
nssm set "%SERVICE%" Start SERVICE_AUTO_START
REM Send Ctrl+C and give Next up to 5s to shut down cleanly on stop.
nssm set "%SERVICE%" AppStopMethodConsole 5000

nssm start "%SERVICE%"
echo.
echo Installed and started "%SERVICE%".
echo   status: nssm status %SERVICE%
echo   logs:   %LOGDIR%\app-out.log  /  app-err.log
echo   stop:   nssm stop %SERVICE%   ^|  remove: nssm remove %SERVICE% confirm
endlocal
