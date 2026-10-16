$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sdkVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'global.json') -Raw | ConvertFrom-Json).sdk.version
$installDir = Join-Path $repoRoot '.tooling/dotnet'
$localDotnet = Join-Path $installDir 'dotnet.exe'
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    $installedSdks = & dotnet --list-sdks
    if ($installedSdks -match "^$([regex]::Escape($sdkVersion)) ") { return }
}
if (Test-Path -LiteralPath $localDotnet) {
    $installedVersion = & $localDotnet --version
    if ($LASTEXITCODE -eq 0 -and $installedVersion -eq $sdkVersion) { return }
}
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'This bootstrap installs the Windows x64 SDK. Install the SDK specified in global.json on other platforms.'
}
$metadataUrl = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json'
$metadata = Invoke-RestMethod -Uri $metadataUrl -TimeoutSec 60
$sdk = @($metadata.releases | ForEach-Object { $_.sdks } | Where-Object { $_.version -eq $sdkVersion }) | Select-Object -First 1
if ($null -eq $sdk) { throw "SDK $sdkVersion is absent from official release metadata." }
$archive = $sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.url.EndsWith('.zip') } | Select-Object -First 1
if ($null -eq $archive) { throw 'The official Windows x64 SDK archive was not found.' }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$archivePath = Join-Path $repoRoot ".tooling/dotnet-sdk-$sdkVersion-win-x64.zip"
$archiveValid = (Test-Path -LiteralPath $archivePath) -and ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA512).Hash -eq $archive.hash)
if (-not $archiveValid) {
    Invoke-WebRequest -Uri $archive.url -OutFile $archivePath -TimeoutSec 600 -UseBasicParsing
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA512).Hash
if ($actualHash -ne $archive.hash) { throw 'SDK archive SHA512 differs from official release metadata.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $installDir -Force
& $localDotnet --version
if ($LASTEXITCODE -ne 0) { throw 'The local SDK did not start.' }
