@echo off
cd /d "%~dp0"
echo Building in: %cd%
"c:\w64devkit\w64devkit\bin\g++.exe" hardware.cpp -o hardware.exe -lws2_32 -static
if %errorlevel%==0 (
    echo Build OK: %cd%\hardware.exe
) else (
    echo Build FAILED
)
pause
