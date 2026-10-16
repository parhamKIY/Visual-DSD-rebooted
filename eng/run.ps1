$applicationArguments = @($args)
. (Join-Path $PSScriptRoot 'common.ps1')
Push-Location $repoRoot
try {
    Invoke-RebootDotNet (@('run', '--project', 'src/VisualDsd.App/VisualDsd.App.csproj', '--configuration', 'Release', '--no-launch-profile', '--') + $applicationArguments)
}
finally { Pop-Location }
