. (Join-Path $PSScriptRoot 'common.ps1')
$target = Join-Path $repoRoot 'artifacts/native/linux-x64/libz3.so'
$libraryHash = 'B6CC142A234129DE3E8AAB68439D71751F16885E27AAD4AF962836B32D8B2980'
if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $libraryHash) { return }
$archive = Join-Path $repoRoot '.tooling/z3/z3-4.12.2-x64-glibc-2.31.zip'
$archiveHash = 'A198851A7403D8B25BAB920BD4A4792EFE1AF5C28A5A932D840AF0472D3A83EB'
New-Item -ItemType Directory -Force -Path (Split-Path $archive), (Split-Path $target) | Out-Null
if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) {
    Invoke-WebRequest -Uri 'https://github.com/Z3Prover/z3/releases/download/z3-4.12.2/z3-4.12.2-x64-glibc-2.31.zip' -OutFile $archive -TimeoutSec 120
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) { throw 'Z3 archive checksum mismatch.' }
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entry = $zip.GetEntry('z3-4.12.2-x64-glibc-2.31/bin/libz3.so')
    if ($null -eq $entry) { throw 'The Z3 archive has no Linux x64 library.' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
}
finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $libraryHash) { throw 'Z3 library checksum mismatch.' }
