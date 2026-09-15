@echo off
REM No-build local server for the procedural tree demo (Windows).
set PORT=%1
if "%PORT%"=="" set PORT=8001
cd /d "%~dp0"
echo == Procedural Tree ==
echo Serving %CD% on http://127.0.0.1:%PORT%
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python "%~dp0serve.py" %PORT%
  goto :eof
)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py "%~dp0serve.py" %PORT%
  goto :eof
)
echo ERROR: no Python found (need python or py for http.server) 1>&2
exit /b 1
