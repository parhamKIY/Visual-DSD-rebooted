. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $repoRoot
try {
    Invoke-RebootDotNet @('build', 'reference/ReferenceBaselines/ReferenceBaselines.fsproj', '--configuration', 'Release', '--verbosity', 'minimal')
    Invoke-RebootDotNet @('reference/ReferenceBaselines/bin/Release/net10.0/ReferenceBaselines.dll', '--record-reference')
}
finally { Pop-Location }
