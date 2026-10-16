param([string] $Runtime = 'win-x64')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Runtime -notin @('win-x64', 'linux-x64')) { throw 'Supported targets: win-x64, linux-x64.' }
$name = if ($Runtime -eq 'win-x64') { 'VisualDsd.exe' } else { 'VisualDsd' }
$publishItems = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot "artifacts/publish/$Runtime"))
if ($publishItems.Count -ne 1 -or $publishItems[0].Name -ne $name) { throw 'The standalone publish directory must contain only the application executable.' }
$directory = Join-Path $repoRoot "artifacts/smoke/$([guid]::NewGuid())/standalone app"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$executable = Join-Path $directory $name
Copy-Item -LiteralPath (Join-Path $repoRoot "artifacts/publish/$Runtime/$name") -Destination $executable

function Start-Standalone {
    param([string[]] $Arguments)
    $start = [System.Diagnostics.ProcessStartInfo]::new($executable)
    $start.WorkingDirectory = $directory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment['DOTNET_ROOT'] = Join-Path $directory 'no-runtime'
    $start.Environment['DOTNET_ROOT_X64'] = $start.Environment['DOTNET_ROOT']
    $start.Environment['DOTNET_MULTILEVEL_LOOKUP'] = '0'
    $start.Environment['PATH'] = if ($IsWindows) { [Environment]::SystemDirectory } else { '/usr/bin:/bin' }
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    return [System.Diagnostics.Process]::Start($start)
}

function Invoke-Standalone {
    param([string[]] $Arguments, [string] $InputText = '', [int] $ExpectedExit = 0)
    $process = Start-Standalone $Arguments
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
        if (!$process.WaitForExit(20000)) { throw 'Standalone command timed out.' }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne $ExpectedExit) { throw "Standalone command exited $($process.ExitCode): $errors $output" }
        return $output
    }
    finally {
        if (!$process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
    }
}

$version = Invoke-Standalone @('--version')
if ($version.Trim() -ne '0.4.0') { throw "Unexpected version: $version" }
$catalytic = Join-Path $repoRoot 'upstream/crn-engine/ClassicDSD/Examples/DSDModels/Catalytic.txt'
$legacy = Join-Path $repoRoot 'upstream/crn-engine/ClassicDSD/ClassicDSDTests/testData/visualDsd/Simple - AND Circuit.vdsd'
$expanded = Invoke-Standalone @('expand', $catalytic) | ConvertFrom-Json
if (!$expanded.success -or $expanded.model.species.Count -ne 9 -or $expanded.model.reactions.Count -ne 4) { throw 'Standalone expansion differs from the reference.' }
$converted = Invoke-Standalone @('expand', $legacy) | ConvertFrom-Json
if (!$converted.success -or $converted.dialect -ne 'legacy' -or $converted.model.species.Count -ne 7) { throw 'Standalone legacy conversion failed.' }
foreach ($simulator in @('oslo', 'ssa')) {
    $simulated = Invoke-Standalone @('simulate', $catalytic, '--simulator', $simulator, '--final', '100', '--points', '20', '--seed', '42') | ConvertFrom-Json
    if (!$simulated.success -or $simulated.model.settings.simulator -ne $simulator -or $simulated.model.simulations.Count -lt 1) { throw "Standalone $simulator simulation failed." }
}
$invalid = Invoke-Standalone -Arguments @('parse', '-') -InputText '<a^' -ExpectedExit 1 | ConvertFrom-Json
if ($invalid.success -or $invalid.diagnostics[0].code -ne 'PARSE_ERROR' -or $invalid.diagnostics[0].line -lt 1) { throw 'Standalone parser diagnostics failed.' }

$server = Start-Standalone @('serve', '--port', '0')
try {
    $stderr = $server.StandardError.ReadToEndAsync()
    $server.StandardInput.Close()
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $address = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        $line = $server.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
        if ($null -eq $line) { throw "Standalone server exited: $($stderr.GetAwaiter().GetResult())" }
        if ($line -match 'Now listening on: (http://127\.0\.0\.1:\d+)') { $address = $Matches[1]; break }
    }
    if (!$address) { throw 'Standalone server did not start.' }
    $stdout = $server.StandardOutput.ReadToEndAsync()
    $page = Invoke-WebRequest "$address/" -TimeoutSec 10
    if ($page.Content -notmatch 'id="editor"' -or $page.Headers['Content-Type'] -notmatch 'text/html') { throw 'The embedded workspace is missing.' }
    foreach ($asset in @('app.js', 'model.js', 'chart.js', 'network.js', 'project.js', 'app.css', 'icon.svg')) {
        if ((Invoke-WebRequest "$address/assets/$asset" -TimeoutSec 10).StatusCode -ne 200) { throw "Missing embedded asset: $asset" }
    }
    $examples = Invoke-RestMethod "$address/api/examples" -TimeoutSec 10
    if ($examples.Count -lt 6 -or !(Invoke-RestMethod "$address/api/examples/catalytic" -TimeoutSec 10).code) { throw 'Embedded examples are missing.' }
    $body = @{ code = Get-Content -LiteralPath $catalytic -Raw; operation = 'expand' } | ConvertTo-Json
    $job = Invoke-RestMethod "$address/api/jobs" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
    do {
        Start-Sleep -Milliseconds 50
        $result = Invoke-RestMethod "$address/api/jobs/$($job.id)" -TimeoutSec 10
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Standalone API job timed out.' }
    } while (!$result.finishedAt)
    if ($result.state -ne 'succeeded' -or $result.result.model.species.Count -ne 9) { throw 'Standalone API expansion failed.' }
    if ((Invoke-RestMethod "$address/health" -TimeoutSec 10).status -ne 'ok') { throw 'Standalone service is unhealthy.' }
}
finally {
    if (!$server.HasExited) { $server.Kill($true); $server.WaitForExit() }
    $server.Dispose()
}
Write-Output "Standalone $Runtime passed: embedded workspace and examples, current and legacy expansion, Oslo, SSA, parser diagnostics, local API."
