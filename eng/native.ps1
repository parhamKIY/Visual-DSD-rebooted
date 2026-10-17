param([string] $Runtime)
. (Join-Path $PSScriptRoot 'common.ps1')
if (!$Runtime) { $Runtime = if ($IsWindows) { 'win-x64' } else { 'linux-x64' } }
$hostRuntime = if ($IsWindows) { 'win-x64' } else { 'linux-x64' }
if ($Runtime -ne $hostRuntime -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw "Build native solvers on their target x64 platform ($Runtime requested, $hostRuntime host)."
}
$nativeRoot = Join-Path $repoRoot 'native'
$output = Join-Path $repoRoot "artifacts/native/$Runtime"
$library = Join-Path $output $(if ($IsWindows) { 'visualdsd_sundials.dll' } else { 'libvisualdsd_sundials.so' })
$inputs = Get-ChildItem -LiteralPath $nativeRoot -Recurse -File | Sort-Object FullName
$fingerprint = (($inputs | Get-FileHash -Algorithm SHA256).Hash -join '') + (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
$stamp = Join-Path $output 'inputs.sha256'
if ((Test-Path -LiteralPath $library) -and (Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $fingerprint) { return }
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if ($cmake) { $cmakePath = $cmake.Source }
elseif ($IsWindows) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (!$vs) { throw 'Install Visual Studio Build Tools with Desktop development with C++ and CMake.' }
    $cmakePath = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
} else { throw 'Install CMake and an x64 C/C++ compiler to build native solvers.' }
$vendor = Join-Path $nativeRoot 'vendor'
$archive = Join-Path $vendor 'sundials-3.1.2.tar.gz'
$metadata = Get-Content -LiteralPath (Join-Path $vendor 'sources.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.archiveSha256) { throw 'SUNDIALS source checksum mismatch.' }
$sourceRoot = Join-Path $repoRoot '.tooling/native/source'
$build = Join-Path $repoRoot ".tooling/native/build/$Runtime"
New-Item -ItemType Directory -Path $sourceRoot, $output -Force | Out-Null
Push-Location $sourceRoot
try {
    & $cmakePath -E tar xzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract SUNDIALS sources.' }
} finally { Pop-Location }
$configure = @('-S', $nativeRoot, '-B', $build, "-DSUNDIALS_SOURCE=$sourceRoot/sundials-3.1.2", "-DNATIVE_OUTPUT=$output", '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5')
if ($IsWindows) { $configure += @('-A', 'x64') }
& $cmakePath @configure
if ($LASTEXITCODE -ne 0) { throw 'Native solver configuration failed.' }
& $cmakePath --build $build --config Release --target visualdsd_sundials --parallel 4
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $library)) { throw 'Native solver build failed.' }
$fingerprint | Set-Content -LiteralPath $stamp -Encoding utf8NoBOM
