$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-RebootDotNet {
    $local = Join-Path $repoRoot '.tooling/dotnet/dotnet.exe'
    if (Test-Path -LiteralPath $local) { return $local }
    return (Get-Command dotnet -ErrorAction Stop).Source
}

function Invoke-RebootDotNet {
    param([string[]] $CommandArguments)
    $dotnet = Get-RebootDotNet
    & $dotnet @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "dotnet failed with exit code $LASTEXITCODE." }
}
