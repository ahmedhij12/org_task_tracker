@echo off
cd /d "%~dp0"
echo Starting Rungs dev server...
echo.
echo Once it's ready, open the exp:// URL it prints on your phone in Expo Go
echo (same Wi-Fi network as this PC).
echo.
call npx expo start
pause
