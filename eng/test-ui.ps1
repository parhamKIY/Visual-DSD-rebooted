$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tests = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tests/Ui') -Filter '*.test.mjs' | ForEach-Object FullName
& node --test @tests
if ($LASTEXITCODE -ne 0) { throw 'Workspace unit tests failed.' }
