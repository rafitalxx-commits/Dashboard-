@echo off
setlocal

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Ejecuta este archivo como administrador.
  echo Boton derecho sobre el archivo ^> Ejecutar como administrador.
  pause
  exit /b 1
)

set "QZ_DIR=%ProgramFiles%\QZ Tray"
if not exist "%QZ_DIR%" set "QZ_DIR=%ProgramFiles(x86)%\QZ Tray"

if not exist "%QZ_DIR%" (
  echo No encuentro la carpeta de QZ Tray.
  echo Instala o abre QZ Tray y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo Instalando certificado de confianza del LAB en QZ Tray...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://dashboard.todoelectrico.net/qz/override.crt' -OutFile '%QZ_DIR%\override.crt'"

if not exist "%QZ_DIR%\override.crt" (
  echo No se pudo copiar override.crt en QZ Tray.
  pause
  exit /b 1
)

echo Reiniciando QZ Tray...
taskkill /IM qz-tray.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%QZ_DIR%\qz-tray.exe"

echo Listo. Vuelve al LAB, pulsa Ctrl+F5 y prueba QZ de nuevo.
pause
