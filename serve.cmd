@echo off
setlocal
cd /d "%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8231"

echo.
echo   Add to Alt1 by pasting this into Alt1's browser address bar:
echo.
echo      alt1://addapp/http://localhost:%PORT%/appconfig.json
echo.
echo   Leave this window open while you play. Ctrl-C or close it to stop.
echo.

where node  >nul 2>nul && goto :node
where py    >nul 2>nul && goto :py
where python >nul 2>nul && goto :python
where python3 >nul 2>nul && goto :python3
goto :none

:node
echo   [serving with Node]
node tools\serve.js %PORT%
goto :done

:py
echo   [serving with Python via the py launcher]
py -m http.server %PORT% -b 127.0.0.1
goto :done

:python
echo   [serving with Python]
python -m http.server %PORT% -b 127.0.0.1
goto :done

:python3
echo   [serving with Python3]
python3 -m http.server %PORT% -b 127.0.0.1
goto :done

:none
echo   Could not find node, py, python or python3 on the PATH.
echo   If Python is installed, open a terminal and check which name works:
echo       python --version
echo       py --version
echo   then run:  python -m http.server %PORT% -b 127.0.0.1
echo   from this folder.

:done
pause
