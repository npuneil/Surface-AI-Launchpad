@echo off
:: NPUniversity One-Click Installer
:: Right-click -> Run as administrator, OR just double-click (will self-elevate)
::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

:: Self-elevate if not admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%~dp0'"
    exit /b
)

cd /d "%~dp0"
echo.
echo  ========================================
echo   NPUniversity Installer
echo  ========================================
echo.

:: 1. Find the certificate
set "CERT="
for %%f in (*.cer) do set "CERT=%%f"
if not defined CERT (
    echo [ERROR] No .cer certificate file found in this folder.
    echo         Re-download the zip from the Releases page.
    pause
    exit /b 1
)
echo [1/4] Trusting certificate: %CERT%
certutil -addstore TrustedPeople "%CERT%" >nul 2>&1
if %errorlevel% neq 0 (
    echo        Trying alternate method...
    powershell -Command "Import-Certificate -FilePath '%CERT%' -CertStoreLocation Cert:\LocalMachine\TrustedPeople" >nul 2>&1
)
echo       Done.

:: 2. Detect architecture
set "ARCH="
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="x86"   set "ARCH=x64"
if not defined ARCH set "ARCH=x64"
echo [2/4] Detected architecture: %ARCH%

:: 3. Find and install the MSIX
set "MSIX="
for %%f in (*%ARCH%*.msix) do set "MSIX=%%f"
if not defined MSIX (
    :: Fall back to any .msix in the folder
    for %%f in (*.msix) do set "MSIX=%%f"
)
if not defined MSIX (
    echo [ERROR] No .msix package found in this folder.
    echo         Re-download the zip from the Releases page.
    pause
    exit /b 1
)
echo [3/4] Installing: %MSIX%
powershell -Command "Add-AppxPackage -Path '%MSIX%' -ForceApplicationShutdown" 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [NOTE] If you see an error above, try enabling Developer Mode:
    echo        Settings -^> System -^> For developers -^> Developer Mode = On
    echo        Then run this installer again.
    pause
    exit /b 1
)
echo       Done.

:: 4. Launch the app
echo [4/4] Launching NPUniversity...
powershell -Command "Start-Process 'shell:AppsFolder\NPUniversity_1.0.7.0_x64__8wekyb3d8bbwe!App'" 2>nul
if %errorlevel% neq 0 (
    echo       Launch from Start menu: search for "NPUniversity"
)

echo.
echo  ========================================
echo   Installation complete!
echo  ========================================
echo.
echo  NPUniversity is now in your Start menu.
echo  You can close this window.
echo.
timeout /t 5
