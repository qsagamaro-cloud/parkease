@echo off
cd /d "%~dp0"

if not exist .env (
    echo ERROR: .env file not found. Copy .env.example to .env and fill in your Supabase keys.
    pause
    exit /b
)

if not exist node_modules (
    echo Installing packages, first time only...
    call npm install
)

start "PARKEASE Server" cmd /k node server.js
timeout /t 3 /nobreak >nul

if exist arduino\hardware.exe (
    start "PARKEASE Hardware" arduino\hardware.exe
) else (
    echo hardware.exe not found. Run arduino\build.bat first.
    pause
)
start http://localhost:3000
