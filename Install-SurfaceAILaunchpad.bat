@echo off
:: Surface AI Launchpad One-Click Installer
:: Detects your silicon (Intel/AMD vs Snapdragon) and installs the right version.
:: Double-click to run ? it will self-elevate to admin if needed.
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
echo  ==========================================
echo   Surface AI Launchpad Installer
echo  ==========================================
echo.

:: 1. Install signing certificate to Trusted People store
echo [1/4] Installing certificate...
if exist "%~dp0SurfaceAILaunchpad.cer" (
    certutil -addstore TrustedPeople "%~dp0SurfaceAILaunchpad.cer" >nul 2>&1
    if %errorlevel% neq 0 (
        echo       WARNING: Certificate install failed. Retrying with PowerShell...
        powershell -Command "Import-Certificate -FilePath '%~dp0SurfaceAILaunchpad.cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople" >nul 2>&1
        if %errorlevel% neq 0 (
            echo       ERROR: Could not install certificate. Are you running as Administrator?
            echo       Right-click this file and choose "Run as administrator".
            pause
            exit /b 1
        )
    )
    echo       Done.
) else (
    echo       Certificate not found - install may fail.
)

:: 2. Detect architecture
set "ARCH="
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "ARCH=arm64"
    echo [2/4] Detected: Snapdragon / ARM64
) else (
    set "ARCH=x64"
    echo [2/4] Detected: Intel / AMD / x64
)

:: 3. Find and install the matching MSIX
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
powershell -Command "try { Add-AppxPackage -Path '%MSIX%' -ForceApplicationShutdown -ErrorAction Stop; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if %errorlevel% neq 0 (
    echo.
    echo [NOTE] Install failed. Common fixes:
    echo        1. Re-run this installer by right-clicking and choosing "Run as administrator"
    echo        2. If that doesn't work, enable Developer Mode:
    echo           Settings -^> System -^> For developers -^> Developer Mode ON
    echo        Then run this installer again.
    pause
    exit /b 1
)
echo       Done.

:: 4. Launch the app
echo [4/4] Launching Surface AI Launchpad...
timeout /t 2 /nobreak >nul
powershell -Command "Get-AppxPackage -Name '*SurfaceAILaunchpad*' | ForEach-Object { Start-Process ('shell:AppsFolder\' + $_.PackageFamilyName + '!App') }" 2>nul
if %errorlevel% neq 0 (
    echo       Launch from Start menu: search for "Surface AI Launchpad"
)

echo.
echo  ==========================================
echo   Installation complete!
echo  ==========================================
echo.
echo  Surface AI Launchpad is now in your Start menu.
echo  You can close this window.
echo.
timeout /t 5
