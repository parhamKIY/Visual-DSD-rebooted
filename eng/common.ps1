$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-RebootDotNet {
    $local = Join-Path $repoRoot '.tooling/dotnet/dotnet.exe'
    $sdkVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'global.json') -Raw | ConvertFrom-Json).sdk.version
    if (Test-Path -LiteralPath $local) {
        $localSdks = & $local --list-sdks
        if ($localSdks -match "^$([regex]::Escape($sdkVersion)) ") { return $local }
    }
    return (Get-Command dotnet -ErrorAction Stop).Source
}

function Invoke-RebootDotNet {
    param([string[]] $CommandArguments)
    $dotnet = Get-RebootDotNet
    & $dotnet @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "dotnet failed with exit code $LASTEXITCODE." }
}
