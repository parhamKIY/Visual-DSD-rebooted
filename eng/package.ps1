param([ValidateSet('win-x64','linux-x64')][string] $Runtime = 'win-x64', [string] $AppDirectory, [string] $OutputDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$AppDirectory) { $AppDirectory = Join-Path $repoRoot "artifacts/publish/$Runtime" }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'artifacts/packages' }
$executable = if ($Runtime -eq 'win-x64') { 'VisualDsd.exe' } else { 'VisualDsd' }
$app = Join-Path $AppDirectory $executable
$version = (& $app --version).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Cannot identify published application version.' }
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify source commit.' }
$name = "visual-dsd-rebooted-$Runtime-v$version"
# A unique stage avoids carrying files from an earlier build into a release.
$stage = Join-Path $repoRoot "artifacts/package-staging/$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $stage, (Join-Path $stage 'examples'), $OutputDirectory -Force | Out-Null
Copy-Item -LiteralPath $app -Destination (Join-Path $stage $executable)
foreach ($file in @('LICENSE','NOTICE')) { Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stage }
foreach ($file in @('START-HERE.en.md','START-HERE.fa.md')) { Copy-Item -LiteralPath (Join-Path $repoRoot "distribution/$file") -Destination $stage }
Copy-Item -LiteralPath (Join-Path $repoRoot 'upstream/crn-engine/ClassicDSD/Examples/DSDModels/Catalytic.txt') -Destination (Join-Path $stage 'examples/Catalytic.dsd')
Copy-Item -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/state-switch.dsd') -Destination (Join-Path $stage 'examples/State-switch.dsd')
Copy-Item -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/crn-systems.crn') -Destination (Join-Path $stage 'examples/Two-systems.crn')
& node (Join-Path $PSScriptRoot 'write-course-package.mjs') (Join-Path $stage 'course')
if ($LASTEXITCODE -ne 0) { throw 'Course exercise packaging failed.' }
@{ version=$version; runtime=$Runtime; commit=$commit; selfContained=$true; entryPoint=$executable } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'VERSION.json') -Encoding utf8NoBOM
$zip = Join-Path $OutputDirectory "$name.zip"
if (Test-Path -LiteralPath $zip) { throw "Package already exists: $zip" }
Compress-Archive -Path "$stage/*" -DestinationPath $zip
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $name.zip" | Set-Content -LiteralPath "$zip.sha256" -Encoding utf8NoBOM
# Validate the finished archive, including exact payload and build provenance.
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
    $expected = @($executable,'LICENSE','NOTICE','START-HERE.en.md','START-HERE.fa.md','VERSION.json','examples/Catalytic.dsd','examples/State-switch.dsd','examples/Two-systems.crn')
    $expected += @('course/COURSE.en.html','course/COURSE.fa.html','course/samples/coding.fasta','course/samples/aligned.fasta','course/samples/imported.nwk','course/models/conversion-baseline.crn','course/models/expression-baseline.crn','course/models/autoregulation-open.crn','course/models/autoregulation-closed.crn','course/manifest.json')
    $actual = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\','/') })
    if (Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)) { throw 'Release archive payload differs from the approved file list.' }
} finally { $archive.Dispose() }
Write-Output "Verified package: $name.zip"
