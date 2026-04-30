#requires -Version 7.0
<#
.SYNOPSIS
  Build a signed (or unsigned dev-mode) MSIX package for NPUniversity.

.DESCRIPTION
  Wraps `dotnet publish` with the WinUI 3 / Windows App SDK MSIX tooling.
  Produces an .msix file under .\dist\ for the requested platform.

  Examples:
    pwsh ./build-msix.ps1                         # ARM64 unsigned (sideloading w/ dev cert)
    pwsh ./build-msix.ps1 -Platform x64
    pwsh ./build-msix.ps1 -Platform ARM64 -PfxPath .\codesign.pfx -PfxPassword $secret

.NOTES
  - MSIX sideloading requires the Package.appxmanifest publisher CN to match the signing cert subject.
  - For unsigned dev builds, install the auto-generated dev cert with `Add-AppxPackage` after enabling
    Developer Mode in Windows Settings.
#>
[CmdletBinding()]
param(
    [ValidateSet('x64','ARM64')]
    [string] $Platform = 'ARM64',

    [string] $Configuration = 'Release',

    [string] $PfxPath,

    [SecureString] $PfxPassword,

    [string] $OutputDir = (Join-Path $PSScriptRoot '..' 'dist')
)

$ErrorActionPreference = 'Stop'
$projectDir  = $PSScriptRoot
$projectFile = Join-Path $projectDir 'NPUniversity.Desktop.csproj'
$rid = if ($Platform -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }

Write-Host "==> Building NPUniversity MSIX ($Platform / $Configuration)" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$publishArgs = @(
    'publish', $projectFile,
    "-c", $Configuration,
    "-r", $rid,
    "-p:Platform=$Platform",
    "-p:GenerateAppxPackageOnBuild=true",
    "-p:AppxPackageDir=$OutputDir\",
    "-p:AppxBundle=Never",
    "-p:UapAppxPackageBuildMode=SideloadOnly",
    "-p:AppxPackageSigningEnabled=$([bool]$PfxPath)".ToLower()
)

if ($PfxPath) {
    if (-not (Test-Path $PfxPath)) { throw "Signing cert not found: $PfxPath" }
    $publishArgs += "-p:PackageCertificateKeyFile=$PfxPath"
    if ($PfxPassword) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PfxPassword)
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $publishArgs += "-p:PackageCertificatePassword=$plain"
    }
} else {
    Write-Warning "No -PfxPath supplied. Building unsigned — install with PowerShell:"
    Write-Warning "  Add-AppxPackage -Path <msix> -AllowUnsigned   (requires Developer Mode)"
}

& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

Write-Host "`n==> Output:" -ForegroundColor Green
Get-ChildItem -Path $OutputDir -Filter '*.msix' -Recurse | Select-Object FullName, Length, LastWriteTime
