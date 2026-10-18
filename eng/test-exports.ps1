param([string] $Runtime = 'win-x64', [string] $AppDirectory)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $repoRoot
try {
    $python = if ($IsWindows) { 'artifacts/export-validation-venv/Scripts/python.exe' } else { 'artifacts/export-validation-venv/bin/python' }
    if (!(Test-Path -LiteralPath $python)) { throw 'Create artifacts/export-validation-venv with Python 3.11 and install python-libsbml==5.21.2 for independent export verification.' }
    if (!$AppDirectory) { $AppDirectory = Join-Path $repoRoot "artifacts/publish/$Runtime" }
    $app = Join-Path $AppDirectory "VisualDsd$(if ($IsWindows) { '.exe' })"
    $arguments = @('eng/validate-exports.py', '--app', $app)
    if (!$IsWindows) { $arguments += '--octave' }
    & $python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Independent scientific export verification failed.' }
}
finally { Pop-Location }
