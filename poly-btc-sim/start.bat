@echo off
echo ========================================
echo   PolyBTC - Polymarket BTC 5min Mirror
echo   Starting local server...
echo ========================================
echo.
echo Browser will open automatically.
echo Press Ctrl+C to stop.
echo.

:: Try Python first
where python >nul 2>nul
if %errorlevel%==0 (
    start http://localhost:8080
    python -m http.server 8080
    goto end
)

where python3 >nul 2>nul
if %errorlevel%==0 (
    start http://localhost:8080
    python3 -m http.server 8080
    goto end
)

:: Try Node.js
where npx >nul 2>nul
if %errorlevel%==0 (
    start http://localhost:3000
    npx serve -l 3000 .
    goto end
)

echo ERROR: Need Python or Node.js installed.
echo.
echo Install Python: https://www.python.org/downloads/
echo Or Node.js: https://nodejs.org/
echo.
pause

:end
