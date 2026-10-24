param([Parameter(Mandatory)][string] $Package, [ValidateSet('win-x64')][string] $Runtime = 'win-x64')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts'))
$packagePath = (Resolve-Path -LiteralPath $Package).Path
$checksumPath = "$packagePath.sha256"
if (!(Test-Path -LiteralPath $checksumPath)) { throw 'The package checksum is missing.' }
$checksum = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]
if ($checksum -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) { throw 'Package checksum mismatch.' }
$archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
$approved = @('VisualDsd.exe','LICENSE','NOTICE','START-HERE.en.md','START-HERE.fa.md','VERSION.json','examples/Catalytic.dsd','examples/State-switch.dsd','examples/Two-systems.crn')
$approved += @('course/COURSE.en.html','course/COURSE.fa.html','course/samples/coding.fasta','course/samples/aligned.fasta','course/samples/imported.nwk','course/models/conversion-baseline.crn','course/models/expression-baseline.crn','course/models/autoregulation-open.crn','course/models/autoregulation-closed.crn','course/manifest.json')
try {
    $actual = @($archive.Entries | Where-Object Name | ForEach-Object { $_.FullName.Replace('\','/') })
    if (Compare-Object ($approved | Sort-Object) ($actual | Sort-Object)) { throw 'Unexpected package contents.' }
    $reader = [IO.StreamReader]::new($archive.GetEntry('VERSION.json').Open())
    try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ([IO.Path]::GetFileName($packagePath) -ne "visual-dsd-rebooted-$Runtime-v$($metadata.version).zip") { throw 'The package name differs from its version metadata.' }
    $head = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ($metadata.version -notmatch '^\d+\.\d+\.\d+$' -or $metadata.runtime -ne $Runtime -or $metadata.commit -ne $head -or $metadata.selfContained -ne $true -or $metadata.entryPoint -ne 'VisualDsd.exe') { throw 'Package provenance does not match this checkout.' }
} finally { $archive.Dispose() }

function Assert-GeneratedPath([string] $Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (!$resolved.StartsWith($artifactsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing cleanup outside artifacts: $resolved" }
    if (Test-Path -LiteralPath $resolved) {
        if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked path: $resolved" }
        if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "Refusing linked contents: $resolved" }
    }
    return $resolved
}
$publishRoot = Join-Path $artifactsRoot 'publish'
$destination = Join-Path $publishRoot $Runtime
$current = Join-Path $artifactsRoot 'releases/current'
$stage = Assert-GeneratedPath (Join-Path $artifactsRoot ('local-install-' + [guid]::NewGuid()))
[IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $stage)
try {
    $newExe = Join-Path $stage 'VisualDsd.exe'
    $version = (& $newExe --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne $metadata.version) { throw 'Packaged executable version mismatch.' }
    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($publishRoot + '\', [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count) { throw 'Close running local builds before activating the new package. No process was stopped.' }
    New-Item -ItemType Directory -Path $destination, $current -Force | Out-Null
    Copy-Item -LiteralPath $newExe -Destination (Join-Path $destination 'VisualDsd.exe') -Force
    if ((Get-FileHash -LiteralPath $newExe).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination 'VisualDsd.exe')).Hash) { throw 'Installed executable verification failed.' }
    $currentPackage = Join-Path $current ([IO.Path]::GetFileName($packagePath))
    if ($packagePath -ne $currentPackage) { Copy-Item -LiteralPath $packagePath -Destination $currentPackage -Force; Copy-Item -LiteralPath $checksumPath -Destination "$currentPackage.sha256" -Force }

    # Delete only recognized generated builds. Unknown contents stop cleanup rather than deleting user work.
    $oldBuilds = @(Get-ChildItem -LiteralPath $publishRoot -Directory | Where-Object { $_.Name -match '^win-x64-\d+\.\d+\.\d+$' -or $_.Name -eq 'student-021-qa' })
    foreach ($directory in $oldBuilds) {
        $target = Assert-GeneratedPath $directory.FullName
        $files = @(Get-ChildItem -LiteralPath $target -Recurse -File -Force)
        if ($files | Where-Object Name -ne 'VisualDsd.exe') { throw "Unrecognized files in old build: $target" }
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    $oldReleases = @(Get-ChildItem -LiteralPath (Join-Path $artifactsRoot 'releases') -Directory | Where-Object Name -Match '^v\d+\.\d+\.\d+$')
    $oldPackages = @('student-final-package','student-local-package','packages','package-staging') | ForEach-Object { Join-Path $artifactsRoot $_ } | Where-Object { Test-Path -LiteralPath $_ }
    foreach ($directory in @($oldReleases.FullName) + @($oldPackages)) {
        if (!$directory) { continue }
        $target = Assert-GeneratedPath $directory
        foreach ($file in Get-ChildItem -LiteralPath $target -Recurse -File -Force) {
            if ($file.Name -notin @('VisualDsd.exe','VisualDsd','LICENSE','NOTICE','START-HERE.en.md','START-HERE.fa.md','VERSION.json','Catalytic.dsd','State-switch.dsd','Two-systems.crn','COURSE.en.html','COURSE.fa.html','coding.fasta','aligned.fasta','imported.nwk','conversion-baseline.crn','expression-baseline.crn','autoregulation-open.crn','autoregulation-closed.crn','manifest.json') -and $file.Name -notmatch '^visual-dsd-rebooted-(win-x64|linux-x64)(-v\d+\.\d+\.\d+)?\.zip(\.sha256)?$') { throw "Unrecognized file in generated packages: $($file.FullName)" }
        }
        if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw "Old package is running: $target" }
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    foreach ($file in Get-ChildItem -LiteralPath $current -File) {
        if ($file.FullName -notin @($currentPackage, "$currentPackage.sha256") -and $file.Name -match '^visual-dsd-rebooted-win-x64-v\d+\.\d+\.\d+\.zip(\.sha256)?$') {
            $target = Assert-GeneratedPath $file.FullName
            Remove-Item -LiteralPath $target -Force
        }
    }
    Write-Output "Active local build: $version"
    Write-Output (Join-Path $destination 'VisualDsd.exe')
    Write-Output $currentPackage
} finally {
    $target = Assert-GeneratedPath $stage
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
