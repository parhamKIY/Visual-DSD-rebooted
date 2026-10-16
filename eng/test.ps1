param([switch] $Locked)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $repoRoot
try {
    $restoreArguments = @('restore', 'VisualDsd.Rebooted.slnx', '--verbosity', 'minimal')
    if ($Locked) { $restoreArguments += '--locked-mode' }
    Invoke-RebootDotNet $restoreArguments
    Invoke-RebootDotNet @('test', 'VisualDsd.Rebooted.slnx', '--no-restore', '--configuration', 'Release', '--verbosity', 'minimal', '--logger', 'trx;LogFileName=engine-tests.trx', '--results-directory', (Join-Path $repoRoot 'artifacts/test-results'), '--blame-hang', '--blame-hang-timeout', '60s')
}
finally { Pop-Location }
