param([string] $Runtime = 'win-x64', [string] $AppDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Runtime -notin @('win-x64', 'linux-x64')) { throw 'Supported targets: win-x64, linux-x64.' }
$name = if ($Runtime -eq 'win-x64') { 'VisualDsd.exe' } else { 'VisualDsd' }
if (!$AppDirectory) { $AppDirectory = Join-Path $repoRoot "artifacts/publish/$Runtime" }
$publishItems = @(Get-ChildItem -LiteralPath $AppDirectory)
if ($publishItems.Count -ne 1 -or $publishItems[0].Name -ne $name) { throw 'The standalone publish directory must contain only the application executable.' }
$directory = Join-Path $repoRoot "artifacts/smoke/$([guid]::NewGuid())/standalone app"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$executable = Join-Path $directory $name
Copy-Item -LiteralPath (Join-Path $AppDirectory $name) -Destination $executable

function Start-Standalone {
    param([string[]] $Arguments, [hashtable] $ExtraEnvironment = @{})
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
    foreach ($key in $ExtraEnvironment.Keys) { $start.Environment[$key] = $ExtraEnvironment[$key] }
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
if ($version.Trim() -ne '0.19.0') { throw "Unexpected version: $version" }
$crnSource = Get-Content -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/crn-graph.crn') -Raw
$crn = Invoke-Standalone @('simulate', '-', '--language', 'crn', '--node', 'prediction', '--system', 'reversible') $crnSource | ConvertFrom-Json
if (!$crn.success -or $crn.model.kind -ne 'crn' -or $crn.model.program.selectedNodeId -ne 'prediction' -or $crn.model.program.selectedSystemId -ne 'reversible' -or $crn.model.program.edges.Count -ne 1 -or $crn.model.simulations[0].series[0].values[0] -ne 20) { throw 'Standalone CRN selection or program mismatch.' }
$exported = Invoke-Standalone @('export','-','--language','crn','--simulator','oslo','--node','prediction','--system','reversible') $crnSource | ConvertFrom-Json
if (!$exported.success -or $exported.model.exports.Count -ne 6 -or $exported.model.exports.Where({$null -ne $_.diagnostic}).Count -ne 0) { throw 'Standalone scientific exports failed.' }
$sbml = [xml]($exported.model.exports | Where-Object id -eq 'sbml').content
if ($sbml.sbml.level -ne '3' -or $sbml.sbml.version -ne '2') { throw 'Standalone SBML format mismatch.' }
$matlab = $exported.model.exports | Where-Object id -eq 'matlab'
if ($matlab.fileName -ne 'crn_export_run_001.m' -or !$matlab.content.StartsWith('function sol = crn_export_run_001()')) { throw 'Standalone MATLAB file and entry function mismatch.' }
$crnFile = Join-Path $directory 'linked.crn'
Set-Content -LiteralPath $crnFile -Value $crnSource -Encoding utf8NoBOM
$detected = Invoke-Standalone @('parse', $crnFile, '--node', 'calibration', '--system', 'decay') | ConvertFrom-Json
if (!$detected.success -or $detected.model.program.selectedSystemId -ne 'decay') { throw 'CRN file auto-detection failed.' }
$badSelection = Invoke-Standalone @('simulate', $crnFile, '--node', 'missing') -ExpectedExit 1 | ConvertFrom-Json
if ($badSelection.success -or $badSelection.diagnostics[0].code -ne 'CRN_SELECTION') { throw 'Invalid CRN selection was not rejected.' }
$catalytic = Join-Path $repoRoot 'upstream/crn-engine/ClassicDSD/Examples/DSDModels/Catalytic.txt'
$legacy = Join-Path $repoRoot 'upstream/crn-engine/ClassicDSD/ClassicDSDTests/testData/visualDsd/Simple - AND Circuit.vdsd'
$expanded = Invoke-Standalone @('expand', $catalytic) | ConvertFrom-Json
if (!$expanded.success -or $expanded.model.species.Count -ne 9 -or $expanded.model.reactions.Count -ne 4) { throw 'Standalone expansion differs from the reference.' }
$converted = Invoke-Standalone @('expand', $legacy) | ConvertFrom-Json
if (!$converted.success -or $converted.dialect -ne 'legacy' -or $converted.model.species.Count -ne 7) { throw 'Standalone legacy conversion failed.' }
$pastedLegacy = (Get-Content -LiteralPath $legacy -Raw).Replace('//old_syntax', '// original example')
$automaticLegacy = Invoke-Standalone @('expand', '-') $pastedLegacy | ConvertFrom-Json
if (!$automaticLegacy.success -or $automaticLegacy.dialect -ne 'legacy' -or $automaticLegacy.model.species.Count -ne 7 -or $automaticLegacy.model.reactions.Count -ne 4) { throw 'Pasted legacy syntax auto-detection failed.' }
foreach ($simulator in @('oslo', 'ssa', 'sundials')) {
    $simulated = Invoke-Standalone @('simulate', $catalytic, '--simulator', $simulator, '--final', '100', '--points', '20', '--seed', '42') | ConvertFrom-Json
    if (!$simulated.success -or $simulated.model.settings.simulator -ne $simulator -or $simulated.model.simulations.Count -lt 1) { throw "Standalone $simulator simulation failed." }
}
$toeholdPath=Join-Path $directory 'toeholds.txt'
$specificityPath=Join-Path $directory 'specificities.txt'
$optionsPath=Join-Path $directory 'dsd-options.json'
[IO.File]::WriteAllText($toeholdPath,'ACGTAC',[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($specificityPath,'AACCGGTTAA',[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($optionsPath,'{"leaks":false,"renderer":"branches","renderMode":"nucleotides"}',[Text.UTF8Encoding]::new($false))
$dsd=Invoke-Standalone -Arguments @('parse','-','--toeholds',$toeholdPath,'--specificities',$specificityPath,'--dsd-options',$optionsPath) -InputText '<a^ b>' | ConvertFrom-Json
if(!$dsd.success -or $dsd.model.dsd.options.renderer -ne 'branches' -or $dsd.model.dsd.options.leaks -ne $false -or $dsd.model.dsd.sequenceStatus -ne 'assigned') { throw 'Standalone DSD overrides failed.' }
$toe=$dsd.model.dsd.sequences | Where-Object isToehold
if($toe.sequence -ne 'ACGTAC' -or $toe.reverseComplement -ne 'GTACGT') { throw 'Standalone DNA mapping failed.' }
[IO.File]::WriteAllText($optionsPath,'{"imaginary":true}',[Text.UTF8Encoding]::new($false))
$invalidOptions=Invoke-Standalone -Arguments @('parse','-','--dsd-options',$optionsPath) -InputText '<a>' -ExpectedExit 2 | ConvertFrom-Json
if($invalidOptions.success -or $invalidOptions.diagnostics[0].code -ne 'COMMAND_ERROR') { throw 'Invalid DSD settings were not rejected.' }
[IO.File]::WriteAllText($toeholdPath,('A' * (256*1024+4)),[Text.UTF8Encoding]::new($false))
$oversized=Invoke-Standalone -Arguments @('parse','-','--toeholds',$toeholdPath) -InputText '<a>' -ExpectedExit 2 | ConvertFrom-Json
if($oversized.success -or $oversized.diagnostics[0].code -ne 'COMMAND_ERROR') { throw 'Oversized sequence input was not rejected.' }
$invalid = Invoke-Standalone -Arguments @('parse', '-') -InputText '<a^' -ExpectedExit 1 | ConvertFrom-Json
if ($invalid.success -or $invalid.diagnostics[0].code -ne 'PARSE_ERROR' -or $invalid.diagnostics[0].line -lt 1) { throw 'Standalone parser diagnostics failed.' }
$jitSource = @'
directive jit
directive simulator stochastic
directive parameters [N=1]
directive sweeps [dose=[N=[2;7]]]
directive simulations [short={initial=5;final=6;points=5;seed=42};long={initial=5;final=7;points=5;seed=43}]
N * <a>
'@
$jitBatch = Invoke-Standalone -Arguments @('simulate', '-') -InputText $jitSource | ConvertFrom-Json
if (!$jitBatch.success -or $jitBatch.model.simulations.Count -ne 4) { throw 'Standalone JIT batch failed.' }
for ($runIndex = 0; $runIndex -lt 4; $runIndex++) {
    $run = $jitBatch.model.simulations[$runIndex]
    $expectedPopulation = if ($runIndex % 2 -eq 0) { '2' } else { '7' }
    $expectedEnd = if ($runIndex -lt 2) { 6 } else { 7 }
    if ($run.network.species[0].initial -ne $expectedPopulation -or $run.times[0] -ne 5 -or $run.times[-1] -ne $expectedEnd -or $run.settings.seed -ne $run.seed) { throw 'Standalone JIT run data mismatch.' }
}
$decaySource = @'
directive simulation {final=5;points=20;plots=[<a>]}
directive parameters [k=0.35]
(10 * <a> | rxn <a> ->{k} <b>)
'@
foreach ($statisticalSolver in @('lna', 'cme', 'cmesundials')) {
    $statistics = Invoke-Standalone -Arguments @('simulate', '-', '--simulator', $statisticalSolver) -InputText $decaySource | ConvertFrom-Json
    $trace = $statistics.model.simulations[0].series[0]
    if (!$statistics.success -or $trace.standardDeviation.Count -ne $trace.values.Count -or [Math]::Abs($trace.values[-1] - 10 * [Math]::Exp(-1.75)) -gt 0.01) { throw "Standalone $statisticalSolver differs from the analytic decay solution." }
    if ($statisticalSolver -ne 'lna') {
        $run = $statistics.model.simulations[0]
        $probabilities = $run.probabilities
        if ($probabilities.states.Count -ne 11 -or $probabilities.mass.Count -ne $run.times.Count) { throw 'Standalone joint CME probabilities are incomplete.' }
        foreach ($row in $probabilities.mass) {
            $total = ($row | Measure-Object -Sum).Sum
            if ([Math]::Abs($total - 1) -gt 1e-10) { throw 'Standalone CME mass is not conserved.' }
        }
    }
}
$scaledSource = @'
directive stochastic {scale=2}
directive simulation {final=1;points=20;plots=[A;([A]+[B])]}
| 5 A | A ->{0.35} B
'@
foreach ($solver in @('lna', 'cme', 'cmesundials')) {
    $scaled = Invoke-Standalone -Arguments @('simulate', '-', '--language', 'crn', '--simulator', $solver) -InputText $scaledSource | ConvertFrom-Json
    $run = $scaled.model.simulations[0]
    if (!$scaled.success -or $run.series[0].values[0] -ne 10 -or [Math]::Abs($run.series[1].values[-1] - 10) -gt 1e-8 -or $run.series[1].standardDeviation[-1] -gt 1e-6) { throw "Standalone $solver scaling or covariance failed." }
}
$sampledSpatialSource = @'
directive simulation {initial=2;final=3;points=10;times=[2;2.25;2.7;3];plots=[A]}
directive spatial {nx=129;default_diffusion=0;dt=0.01}
| 10 A | A ->{0.35} B
'@
$sampledSpatial = Invoke-Standalone -Arguments @('simulate', '-', '--language', 'crn', '--simulator', 'pde') -InputText $sampledSpatialSource | ConvertFrom-Json
$sampledRun = $sampledSpatial.model.simulations[0]
if (!$sampledSpatial.success -or $sampledRun.spatial.x.Count -ne 129 -or $sampledRun.times.Count -ne 4 -or $sampledRun.times[1] -ne 2.25 -or [Math]::Abs($sampledRun.series[0].values[-1] - 10 * [Math]::Exp(-0.35)) -gt 0.01) { throw 'Standalone large-grid spatial output sampling failed.' }
$jitAnalysisSource = @'
directive jit
dom a = {bind=0.1;unbind=0.2}
(2 * <a^ b> | 2 * {a^*}[b])
'@
$jitAnalysis = Invoke-Standalone -Arguments @('analyze', '-') -InputText $jitAnalysisSource | ConvertFrom-Json
$jitGraph = $jitAnalysis.model.simulations[0].stateSpace
if (!$jitAnalysis.success -or !$jitAnalysis.model.isJit -or $jitGraph.states.Count -ne 3 -or $jitGraph.transitions.Count -ne 2 -or !$jitAnalysis.model.simulations[0].network) { throw 'Standalone lazy JIT state generation failed.' }
$momentSource = @'
directive simulator mc
directive simulation {final=2;points=20}
directive moments {order=2;plots=[<A>]}
| 10 A | A ->{0.5}
'@
$momentResult = Invoke-Standalone -Arguments @('simulate', '-', '--language', 'crn') -InputText $momentSource | ConvertFrom-Json
$momentTrace = $momentResult.model.simulations[0].series[0]
if (!$momentResult.success -or $momentResult.model.settings.simulator -ne 'mc' -or $momentTrace.standardDeviation.Count -ne $momentTrace.values.Count -or [Math]::Abs($momentTrace.values[-1] - 10 * [Math]::Exp(-1)) -gt 0.01) { throw 'Standalone moment closure differs from the analytic solution.' }
$linkedSource = Get-Content -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/inference-linked.crn') -Raw
$linkedData = Get-Content -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/inference-linked.data.json') -Raw | ConvertFrom-Json
$linkedArguments = @('infer','-','--language','crn','--node','prediction')
foreach ($dataset in $linkedData) {
    $table=$dataset.tables[0]
    $csvLines=@('Time (s),A,C')
    for($i=0;$i -lt $table.times.Count;$i++) {
        $csvLines+=(@($table.times[$i],$table.series[0].values[$i],$table.series[1].values[$i]) | ForEach-Object { ([double]$_).ToString('R',[Globalization.CultureInfo]::InvariantCulture) }) -join ','
    }
    $csvPath=Join-Path $directory ($dataset.name+'.csv')
    [IO.File]::WriteAllLines($csvPath,$csvLines,[Text.UTF8Encoding]::new($false))
    $linkedArguments+=@('--data',$csvPath)
}
$linked=Invoke-Standalone -Arguments $linkedArguments -InputText $linkedSource | ConvertFrom-Json
if(!$linked.success -or $linked.model.inferenceNodes.Count -ne 2 -or $linked.model.inference.chains.Count -ne 2 -or $linked.model.inference.retainedSamples -ne 80) { throw 'Standalone linked multichain inference failed.' }
$linkedRate=$linked.model.inference.parameters | Where-Object name -eq 'k'
if([Math]::Abs($linkedRate.mle-0.35) -gt 0.03) { throw 'Standalone linked fit differs from the synthetic known rate.' }
foreach($example in @('synthesis-bistable','synthesis-turing')) {
    $source=Get-Content -LiteralPath (Join-Path $repoRoot "src/VisualDsd.App/WebExamples/$example.crn") -Raw
    $synthesized=Invoke-Standalone -Arguments @('synthesize','-','--language','crn','--phase-trajectories','4') -InputText $source | ConvertFrom-Json
    $synthesis=$synthesized.model.synthesis
    if(!$synthesized.success -or $synthesis.status -ne 'SAT') { throw "Standalone $example failed." }
    foreach($eq in $synthesis.equilibria) {
        if(($eq.residuals | Where-Object { [Math]::Abs($_) -gt 1e-8 }).Count -gt 0 -or $eq.maximumRealEigenvalue -ge 0) { throw "Standalone $example equilibrium check failed." }
    }
    if($example -eq 'synthesis-turing') {
        if($synthesis.dispersion.witnessGrowthRate -le 0 -or $synthesis.equilibria.Count -ne 1) { throw 'Standalone Turing dispersion failed.' }
    } elseif($synthesis.equilibria.Count -ne 2 -or $synthesis.phasePortrait.trajectories.Count -ne 4 -or [Math]::Abs($synthesis.equilibria[0].values[0]-$synthesis.equilibria[1].values[0]) -lt 1.9) { throw 'Standalone bistable roots or trajectories failed.' }
}
$implicitSource=(Get-Content -LiteralPath (Join-Path $repoRoot 'src/VisualDsd.App/WebExamples/synthesis-bistable.crn') -Raw).Replace('->{6} X','->{q} X')
$implicit=Invoke-Standalone -Arguments @('synthesize','-','--language','crn','--phase-trajectories','2') -InputText $implicitSource | ConvertFrom-Json
if(!$implicit.success -or $implicit.model.synthesis.status -ne 'SAT' -or $implicit.model.synthesis.phasePortrait.trajectories.Count -ne 2) { throw 'Implicit synthesis parameter assignment failed.' }
$implicitRun=Invoke-Standalone -Arguments @('simulate','-','--language','crn','--simulator','oslo','--final','1','--points','10') -InputText $implicit.model.synthesis.code | ConvertFrom-Json
if(!$implicitRun.success) { throw 'The exported implicit synthesis parameter is not executable.' }
$spatialSource = @'
directive simulator pde
directive simulation {initial=2;final=3;points=10;plots=[<a>]}
directive spatial {dimensions=2;boundary=Periodic;nx=11;xmax=1;dt=0.007;default_diffusion=0.1}
(10 * <a> | rxn <a> ->{0.35} <b>)
'@
$spatial = Invoke-Standalone -Arguments @('simulate', '-') -InputText $spatialSource | ConvertFrom-Json
$spatialRun = $spatial.model.simulations[0]
if (!$spatial.success -or $spatialRun.spatial.dimensions -ne 2 -or $spatialRun.spatial.series[0].frames[0].Count -ne 121 -or $spatialRun.times[-1] -ne 3 -or [Math]::Abs($spatialRun.series[0].values[-1] - 10 * [Math]::Exp(-0.35)) -gt 0.005) { throw 'Standalone spatial reaction-diffusion failed.' }
$stateSpace = Invoke-Standalone -Arguments @('analyze', '-') -InputText '(4 * <a> | rxn <a> ->{0.5} <b> | rxn <b> ->{0.2} <a>)' | ConvertFrom-Json
$graph = $stateSpace.model.simulations[0].stateSpace
if (!$stateSpace.success -or $graph.states.Count -ne 5 -or $graph.transitions.Count -ne 8) { throw 'Standalone state exploration failed.' }

$fitSource = "directive simulator deterministic`n" + $decaySource.Replace('directive parameters [k=0.35]', "directive parameters [k=0.1, {interval=Real;distribution=Uniform(0.01,1);variation=Random}]`ndirective inference {burnin=200;samples=400;thin=5;seed=42;noise_parameter=Fixed(0.1)}`ndirective data [decay]")
$fitPath = Join-Path $directory 'decay.dsd'
$dataPath = Join-Path $directory 'decay.csv'
Set-Content -LiteralPath $fitPath -Value $fitSource -Encoding utf8NoBOM
$dataRows = @(0..10 | ForEach-Object { $time = $_ * 0.5; $value = 10 * [Math]::Exp(-0.35 * $time); $time.ToString('R', [cultureinfo]::InvariantCulture) + ',' + $value.ToString('R', [cultureinfo]::InvariantCulture) })
Set-Content -LiteralPath $dataPath -Value (@('Time (s),<a>') + $dataRows) -Encoding utf8NoBOM
$fitted = Invoke-Standalone -Arguments @('infer', $fitPath, '--data', $dataPath) | ConvertFrom-Json
$estimate = $fitted.model.inference.parameters | Where-Object name -eq 'k'
if (!$fitted.success -or !$estimate -or [Math]::Abs($estimate.mle - 0.35) -gt 0.02 -or $fitted.model.inference.dataPoints -ne 11) { throw 'Standalone inference did not recover the analytic decay rate.' }

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
    foreach ($asset in @('app.js', 'layout.js', 'live-jobs.js', 'dsd-workspace.js', 'exports.js', 'synthesis.js', 'posterior.js', 'model.js', 'chart.js', 'network.js', 'msagl.worker.js', 'msagl.runtime.js', 'project.js', 'observations.js', 'exploration.js', 'app.css', 'icon.svg')) {
        if ((Invoke-WebRequest "$address/assets/$asset" -TimeoutSec 10).StatusCode -ne 200) { throw "Missing embedded asset: $asset" }
    }
    $examples = Invoke-RestMethod "$address/api/examples" -TimeoutSec 10
    if ($examples.Count -ne 125 -or !(Invoke-RestMethod "$address/api/examples/catalytic" -TimeoutSec 10).code) { throw 'Embedded examples are missing.' }
    $originals=@($examples | Where-Object source)
    if($originals.Count -ne 108) { throw 'The original example catalog is incomplete.' }
    foreach($entry in $originals) {
        $example=Invoke-RestMethod "$address/api/examples/$($entry.id)" -TimeoutSec 10
        if(!$example.code -or $example.source -ne $entry.source) { throw 'An original embedded example is unavailable.' }
    }
    $defaults=Invoke-RestMethod "$address/api/sequences/defaults" -TimeoutSec 10
    if(!$defaults.toeholds -or !$defaults.specificities) { throw 'Default sequence databases are missing.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
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
function Get-StandaloneAddress($service) {
    $service.StandardInput.Close()
    $expires=[DateTime]::UtcNow.AddSeconds(15)
    while([DateTime]::UtcNow -lt $expires) {
        $line=$service.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
        if($null -eq $line) { throw 'The compute test service did not start.' }
        if($line -match 'Now listening on: (http://127\.0\.0\.1:\d+)') { return $Matches[1] }
    }
    throw 'The compute test service did not announce an address.'
}
$computeSecret=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$compute=$null;$gateway=$null
try {
    $compute=Start-Standalone -Arguments @('compute','--port','0','--jobs-dir',(Join-Path $directory 'compute-jobs')) -ExtraEnvironment @{ VISUAL_DSD_COMPUTE_TOKEN=$computeSecret }
    $computeErrors=$compute.StandardError.ReadToEndAsync()
    $computeAddress=Get-StandaloneAddress $compute
    $computeOutput=$compute.StandardOutput.ReadToEndAsync()
    $unauthorized=Invoke-WebRequest "$computeAddress/api/info" -SkipHttpErrorCheck -TimeoutSec 10
    if($unauthorized.StatusCode -ne 401) { throw 'Unauthenticated compute access was accepted.' }
    $gateway=Start-Standalone -Arguments @('serve','--port','0','--jobs-dir',(Join-Path $directory 'workspace-jobs')) -ExtraEnvironment @{ VISUAL_DSD_REMOTE_URL=$computeAddress; VISUAL_DSD_REMOTE_TOKEN=$computeSecret }
    $gatewayErrors=$gateway.StandardError.ReadToEndAsync()
    $gatewayAddress=Get-StandaloneAddress $gateway
    $gatewayOutput=$gateway.StandardOutput.ReadToEndAsync()
    if((Invoke-RestMethod "$gatewayAddress/api/execution" -TimeoutSec 10).mode -ne 'remote') { throw 'The standalone gateway did not select remote execution.' }
    $remoteBody=@{code='<a^ b>';operation='simulate';simulator='oslo';final=1;points=3;seed=42;timeoutSeconds=600} | ConvertTo-Json
    $remoteJob=Invoke-RestMethod "$gatewayAddress/api/jobs" -Method Post -ContentType 'application/json' -Body $remoteBody -TimeoutSec 10
    $expires=[DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 50
        $remoteResult=Invoke-RestMethod "$gatewayAddress/api/jobs/$($remoteJob.id)" -TimeoutSec 10
        if([DateTime]::UtcNow -gt $expires) { throw 'The standalone remote calculation timed out.' }
    } while(!$remoteResult.finishedAt)
    if($remoteResult.state -ne 'succeeded' -or !$remoteResult.remoteId -or $remoteResult.engineVersion -ne '0.19.0' -or $remoteResult.result.model.dsd.sequences.Count -ne 2) { throw 'Standalone remote execution failed.' }
    $events=Invoke-WebRequest "$gatewayAddress/api/jobs/$($remoteJob.id)/events" -TimeoutSec 10
    if($events.Headers['Content-Type'] -notmatch 'text/event-stream' -or $events.Content -notmatch 'event: job') { throw 'Standalone job streaming failed.' }
    $slowBody=@{code="directive simulator stochastic`n(1000 * <a> | rxn <a> ->{1.0} <a>)";operation='simulate';final=1e12;points=1;seed=42;timeoutSeconds=600} | ConvertTo-Json
    $slowJob=Invoke-RestMethod "$gatewayAddress/api/jobs" -Method Post -ContentType 'application/json' -Body $slowBody -TimeoutSec 10
    $expires=[DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 50
        $slowResult=Invoke-RestMethod "$gatewayAddress/api/jobs/$($slowJob.id)" -TimeoutSec 10
        if([DateTime]::UtcNow -gt $expires) { throw 'The standalone remote job was not admitted.' }
    } while(!$slowResult.remoteId)
    Invoke-RestMethod "$gatewayAddress/api/jobs/$($slowJob.id)" -Method Delete -TimeoutSec 10 | Out-Null
    do {
        Start-Sleep -Milliseconds 50
        $slowResult=Invoke-RestMethod "$gatewayAddress/api/jobs/$($slowJob.id)" -TimeoutSec 10
        if([DateTime]::UtcNow -gt $expires) { throw 'The standalone remote cancellation timed out.' }
    } while(!$slowResult.finishedAt)
    $remoteStopped=Invoke-RestMethod "$computeAddress/api/jobs/$($slowResult.remoteId)" -Headers @{Authorization="Bearer $computeSecret"} -TimeoutSec 10
    if($slowResult.state -ne 'cancelled' -or $remoteStopped.state -ne 'cancelled') { throw 'Remote cancellation was not confirmed on both services.' }
}
finally {
    foreach($service in @($gateway,$compute)) { if($null -ne $service) { if(!$service.HasExited) { $service.Kill($true);$service.WaitForExit() };$service.Dispose() } }
}
Write-Output "Standalone durable jobs, authenticated remote execution, SSE updates and confirmed remote cancellation passed."
Write-Output "Standalone $Runtime passed: embedded workspace and examples, current and legacy expansion, Oslo, SSA, LNA, CME, native Sundials/CMESundials, moment closure, spatial PDE, joint probability distributions, lazy JIT state generation, bounded state exploration, Z3 multistability and Turing synthesis with phase portraits and dispersion, seeded and multichain linked inference with CSV data, isolated JIT sweeps and named runs, parser diagnostics, local API."
