param([string] $Runtime = 'win-x64', [string] $OutputDirectory)
. (Join-Path $PSScriptRoot 'common.ps1')
if ($Runtime -notin @('win-x64', 'linux-x64')) { throw 'Supported targets: win-x64, linux-x64.' }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "artifacts/publish/$Runtime" }
Push-Location $repoRoot
try {
    Invoke-RebootDotNet @('publish', 'src/VisualDsd.App/VisualDsd.App.csproj', '--configuration', 'Release', '--runtime', $Runtime, '--self-contained', 'true', '--output', $OutputDirectory, '-p:RebootPublish=true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:DebugType=embedded', '-p:DebugSymbols=false')
}
finally { Pop-Location }
