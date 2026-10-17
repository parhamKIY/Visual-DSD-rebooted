param([switch] $Locked)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $repoRoot
try {
    $restoreArguments = @('restore', 'VisualDsd.Rebooted.slnx', '--verbosity', 'minimal')
    if ($Locked) { $restoreArguments += '--locked-mode' }
    Invoke-RebootDotNet $restoreArguments
    $referenceRestoreArguments = @('restore', 'reference/Reference.slnx', '--verbosity', 'minimal')
    if ($Locked) { $referenceRestoreArguments += '--locked-mode' }
    Invoke-RebootDotNet $referenceRestoreArguments
    Invoke-RebootDotNet @('build', 'reference/Reference.slnx', '--no-restore', '--configuration', 'Release', '--verbosity', 'minimal')
    Invoke-RebootDotNet @('reference/ReferenceBaselines/bin/Release/net10.0/ReferenceBaselines.dll', '--verify-reference')
    Invoke-RebootDotNet @('reference/ReferenceBaselines/bin/Release/net10.0/ReferenceBaselines.dll', '--verify-compatibility')
    Invoke-RebootDotNet @('build', 'VisualDsd.Rebooted.slnx', '--no-restore', '--configuration', 'Release', '--verbosity', 'minimal')
    foreach ($project in @('tests/ClassicDSDTests/ClassicDSDTests.fsproj', 'tests/VisualDsd.App.Tests/VisualDsd.App.Tests.csproj')) {
        Invoke-RebootDotNet @('test', $project, '--no-build', '--no-restore', '--configuration', 'Release', '--verbosity', 'minimal', '--logger', 'trx', '--results-directory', (Join-Path $repoRoot 'artifacts/test-results'), '--blame-hang', '--blame-hang-timeout', '60s')
    }
}
finally { Pop-Location }
