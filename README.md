<div align="center">

<img src="docs/assets/icon.svg" alt="Visual DSD Rebooted" width="76" height="76">

# Visual DSD Rebooted

**DNA strand displacement modelling. Familiar syntax. A modern local workspace.**

[![Builds: Windows and Linux](https://img.shields.io/badge/builds-Windows%20%7C%20Linux-0969da)](https://github.com/parhamKIY/Visual-DSD-rebooted/actions/workflows/engine.yml) [![.NET 10](https://img.shields.io/badge/.NET-10-512BD4)](global.json) [![License: MIT](https://img.shields.io/badge/License-MIT-0b6e63.svg)](LICENSE)

[Get the app](#get-the-app) · [Try a model](#try-a-model) · [Command line](#command-line) · [Build & test](#build--test) · [Compatibility](#compatibility--scope)

</div>

Visual DSD Rebooted brings the Visual DSD language and its F# scientific core into a current .NET application. Write strand displacement models, generate reaction networks, simulate their behaviour, and inspect the results in your browser. Calculations run on your own computer.

The application ships with its web interface and runtime. Downloaded builds need no SDK, Node.js, or separate web server, and work offline after extraction. Linux still requires the [native dependencies for .NET](https://learn.microsoft.com/en-us/dotnet/core/install/linux).

![The local Visual DSD workspace showing a model and its simulation results](docs/assets/workspace.png)

## What you can do

| Workflow | Available now |
| --- | --- |
| Follow a student journey | Start a lesson, import a model or resume a project; Check → Simulate → Review → Download follows current completed results. Switch to Full workspace for advanced tools |
| Test logic circuits | Import Seesaw-generated DSD, run up to 16 input cases, follow signals between Boolean nodes, molecular drawings and curves, measure leakage, threshold margin and sustained response, export CSV and save reproducible experiments |
| Compare conditions | Vary input concentrations and declared model parameters, run seeded SSA repeats, retain every case, compare measured outcomes and export the recorded plan and results |
| Explore molecular computing | Compare an illustrative negative-feedback CRN and walk through an independent, bounded Adleman filtering lab with explicit assumptions |
| Submit an exercise | Write your own interpretation, download a printable report or a self-contained ZIP with project, source, settings, CSV and vector plots |
| Learn with examples | 18 guided lessons with Persian/English explanations, click-by-click instructions, expected observations, small experiments and a glossary; teaching copies preserve your edited models |
| Edit reaction networks | Standalone CRN source, multiple systems, selectable model nodes, and dependency graph inspection |
| Write models | Current and legacy Visual DSD syntax, source diagnostics, built-in examples, multiple editable models |
| Configure DSD | Source defaults or per-document overrides for reactions, kinetics, domain checking, JIT and molecular rendering |
| Manage DNA | Editable default/custom sequence databases, compiler domain assignments, reverse complements, CSV and FASTA |
| Generate networks | Default, detailed, finite, and infinite compilation; complete molecular networks using the original MSAGL layered layout, rate labels, five edge-routing modes, editable node positions, expanded view and vector SVG export |
| Simulate | Deterministic Oslo, stochastic SSA, just-in-time SSA, LNA, CME, native Sundials / CMESundials, moment closure, and bounded 1D/2D reaction–diffusion |
| Compare runs | Parameter sweeps, named runs, time-series plots, uncertainty traces, and numerical tables |
| Fit parameters | Seeded MCMC with Oslo / Sundials, multiple chains, joint system fits, linked model inference, and imported observation CSV files |
| Synthesize parameters | Z3 multistability and Turing constraints, equilibrium residuals, dispersion curves, sampled phase trajectories and Jacobian graphs |
| Inspect probabilities | Joint CME probabilities, marginal population distributions, time heatmaps, logarithmic colors, and exact distribution CSV |
| Explore states | Finite population state graphs, lazy JIT state generation, reachable-state inspection, and shortest paths |
| Run in background | Live solver previews, durable job history, reconnect after reload, explicit cancellation, and optional authenticated remote compute |
| Keep your work | Model files, project files with saved results, and CSV, SVG, and JSON exports |

Each calculation runs in a separate worker process with cancellation, a deadline, and memory limits. The workspace listens on localhost and serves its own assets; it needs no account or cloud service.

## Get the app

Download the Windows x64 or Linux x64 ZIP from [Releases](https://github.com/parhamKIY/Visual-DSD-rebooted/releases/latest). Extract it and read `START-HERE.en.md` or `START-HERE.fa.md`. Packages include example models, `VERSION.json`, licenses and a SHA-256 checksum.

Development builds are also attached to successful runs of the [Engine baseline workflow](https://github.com/parhamKIY/Visual-DSD-rebooted/actions/workflows/engine.yml?query=branch%3Amaster).

1. Open a successful run for `master`.
2. Under **Artifacts**, download `visual-dsd-rebooted-win-x64` or `visual-dsd-rebooted-linux-x64`.
3. Extract the downloaded artifact, then extract the application ZIP inside it. Keep `LICENSE` and `NOTICE` with the executable.

Artifacts include a SHA-256 checksum and are retained for 14 days. GitHub sign-in and access to the repository may be required. These are portable builds, not installers.

### Windows x64

Open `VisualDsd.exe`. The application starts and opens the workspace at `http://127.0.0.1:5800`.

To start it from PowerShell without opening a browser automatically:

```powershell
.\VisualDsd.exe serve --port 5800
```

### Linux x64

From the extracted application directory:

```bash
chmod +x VisualDsd
./VisualDsd
```

For a terminal session without automatic browser launch, use `./VisualDsd serve --port 5800`, then open the address above. Press `Ctrl+C` in the server terminal to stop the application. Choose another port if `5800` is occupied.

> Browser storage keeps the current workspace on that browser and origin. Use **Save project** to keep a portable copy of models, settings, observations, and saved results.

## Try a model

The Start page offers **Choose a guided example**, **Open model file**, and **Resume workspace / Open project file**. In Student mode, follow **Check model → Simulate → Review simulation → Download project**. The guide resets when source or settings change and never treats provisional solver output as a completed run. **Full workspace** exposes all tools while preserving model settings. The language control changes the student journey and lessons between English and Persian. Advanced lessons automatically open Full workspace.

Choose a built-in example and simulate it, or paste this small model into the editor:

```text
directive simulator deterministic
directive simulation { final=100; plots=[<a^ b>] }
directive parameters [k=0.003; u=0.1]
dom a = {bind=k; unbind=u}
(10 * <a^ b> | 100 * {a^*}[b])
```

The `^` marks a toehold domain and `*` its complement. Simulation options can come from the model's directives or the workspace controls. The **Species**, **Reactions**, and **Network** views show the expanded model; the simulation view provides plots and data exports.

The editor and results start at equal widths. Drag their center divider to resize them; arrow keys adjust a focused divider, and Enter or a double-click restores equal widths. The browser remembers the split. The editor can also be resized vertically, and narrow screens stack the two panes.

**Syntax**, beside the editor title, offers **Auto-detect**, **Current**, and **Old syntax**. Auto-detect accepts pasted legacy programs without a filename or `//old_syntax` marker: if current-syntax parsing fails, it tries the original Silverlight converter. A valid current program keeps its current interpretation; explicit syntax choices are always honored. The badge shows the resolved syntax after checking or running. The converter's original unsupported directives remain subject to the compatibility limits below.

The searchable library contains 18 workspace examples and all 108 `.txt` / `.dna` sources from the frozen original DSD example collection, grouped by category. Original source text is preserved. These include research models, Rules DSD and WalkerTalk demonstrations; some need additional declarations or data, and inclusion does not establish that every example successfully simulates.

Spatial initial conditions retain their resolved field definition, with full double precision, in results and saved projects. Open **Spatial initial definition** on a species card to inspect point sources, rectangles, central cores and random initialization settings. For repeated DSD declarations of the same species, the original compiler keeps the last spatial definition; CRN input retains separate contributions. Older projects that did not save this metadata remain readable.

Open **DSD settings** to override individual source options without rewriting the source. Empty controls use the source directives and original engine defaults. **Sequence databases** supports editing, importing, saving and independently resetting the toehold and specificity databases. Entries are uppercase A/C/G/T, one sequence per line. Inline diagnostics flag sequence lengths, invalid bases and duplicates; the engine applies the original **Check DNA** setting.

After checking, expanding or running a model, **DSD & Sequences** shows effective options and the compiler's domain-to-DNA assignments, with both strands written 5′ to 3′. Search the assignments or download CSV and FASTA. Missing assignments remain explicit and are excluded from FASTA. This is the classic compiler mapping, not an oligonucleotide design/ordering tool; Rules DSD does not expose that mapping, and domains generated later during JIT execution may be absent. Projects preserve overrides, databases and assignment results; model-source downloads preserve the source alone.

## Edit a reaction network

Use **+ CRN** to start a reaction network directly, or expand a strand model and select **Open expanded network as editable CRN**. The new document is independent of the strand model. `.crn` files select the CRN language automatically; use the language setting for other file extensions.

CRN programs use the original `system`, `node`, and `edge` syntax. Check the source, then select a model node and system to simulate or explore its states. The **Models** tab shows every system and parameter link. Shared and local parameters, functional rates, modules, sweeps, and system inheritance use the original model preparation. Project files preserve the complete source, graph, selection, and saved results.

Simulation runs the selected system. Fitting jointly uses each node's observed systems and follows parameter links across the whole graph. Choose a completed node in the result view to inspect its chains, fitted curves and effective priors.

## Synthesize parameters

Open **CRN · bistable synthesis** or **CRN · Turing synthesis**, then select **Synthesize parameters**. Use the original directive syntax:

```text
directive synthesis {mode=turing;solver=nlsat;timeout=10;seed=7}
directive spatial {diffusibles=[X=1;Y=DY]}
```

The modes are `multistability` and `turing`; solvers are `nlsat` and `portfolio`. Synthesis runs the selected system, including expanded DSD networks. It does not infer parameters from observations. As in the original symbolic engine, parameters are synthesis variables: their assigned starting values do not fix them. Prior distributions supply bounds (normal and log-normal priors use their original three-sigma bounds). Implicit free variables in rate expressions are also synthesized and receive explicit parameter assignments in the exported CRN. Use literal coefficients in reactions for fixed constants. Turing diffusion must be declared explicitly; the PDE default diffusion is not a symbolic synthesis constraint.

**SAT** means the encoded constraints have a satisfying assignment. **UNSAT** applies to those constraints and bounds. **UNKNOWN** establishes neither outcome; the enclosing worker deadline can also stop the calculation. Rounded witness values, ODE residuals and maximum real Jacobian eigenvalues are shown separately. They are computational checks, not experimental validation.

For multistability, phase settings choose two species and up to 16 seeded trajectories over the model's simulation interval; zero trajectories skips simulation. Colors indicate the nearest equilibrium at the final time, with final distances listed. This sampling does not prove convergence or identify entire basins. For Turing results, the dispersion curve plots the largest real eigenvalue of `J − q²D`; the solver's `wc` value is the **squared** wave number. The chart focuses on the sampled instability band; exports retain the full sampled range.

Save projects to retain every witness, curve and trajectory. **Open synthesized CRN** creates a separate document with the synthesized parameter and diffusion values. CSV and SVG exports are available in the Synthesis tab.

## Scientific model exports

Choose **Export model**, then select a resolved run and file in **Exports**. The same operation is available as `./VisualDsd export model.crn` (JSON containing each file and its metadata).

- **SBML Level 3 Version 2** preserves the selected system's deterministic concentration equations, initial populations, constant species, reversible/catalytic reactions, model time and concentration units, named functional rates and time-dependent expressions. Safe generated identifiers retain original species names in `name` attributes. Kinetic laws convert concentration rates to amount rates through the compartment volume. SBML time starts at zero; a nonzero source start time is carried into functional time expressions as an explicit offset.
- **MATLAB / Octave** files integrate the ODEs and return `times`, `populations`, `species`, `plots` and `names`. Keep the downloaded filename: its entry function has the same name. Array indexing avoids collisions with user species or lifted parameter names. Plot expressions use elementwise arithmetic and the actual integration time.
- **LaTeX** contains the resolved ODEs and initial conditions. **SVG** contains the original molecular initial-population and reaction drawings. Completed JIT runs also offer **Final populations SVG** in Species; scheduled future inputs are excluded from that snapshot.
- With **moment closure** selected, additional files contain the unclosed moment equations, closure equations and executable closure MATLAB. The latter preserves the configured `initial_minimum`, numerical clamping, moment plots and available standard deviations; unavailable deviations are `NaN`.

Use **Oslo** or **Sundials** for deterministic model exports. Stochastic/statistical and spatial dynamics are not silently replaced by ODEs. Scheduled inputs currently remain in the resolved CRN file; SBML/MATLAB/LaTeX report an unavailable-format diagnostic rather than dropping those inputs. Other valid files remain downloadable. Every sweep or named simulation run has its own files and assignment metadata, capped at 32 runs and 4 MiB per request. Saved projects retain file contents and diagnostics. SBML does not encode the requested simulation grid, plots, inference configuration or moment-closure solver; it represents the resolved reaction model.

CI checks SBML consistency with pinned **libSBML 5.21.2**, integrates its MathML equations independently, and executes the MATLAB files with **Octave** on Linux, including moment-closure means and uncertainties. These validation tools are development dependencies; the downloaded application remains standalone.

## Live calculations and background jobs

The workspace receives server-sent job updates. Oslo, single-trajectory SSA and JIT can show a provisional curve while the solver is running: at most the latest 200 solver rows and the first eight configured plots. Other solvers expose preparation/run status; inference reports actual chain starts and completions. Preview CSV is labelled provisional, and previews never replace a completed result or become a saved successful project result. Completed results retain their original solver output and precision.

Use **Keep running in background**, then **Jobs → Monitor** to reconnect or **Inspect result** to retrieve a completed calculation and its original input. Reloading or closing the browser does not cancel admitted work. The last monitored job reconnects on reload; the Jobs list retains other admitted jobs. **Cancel** explicitly stops a job. Connection failures do not automatically resubmit or cancel calculations.

Time limits range from 1 to 86400 seconds (24 hours), with a 30-second default. The deadline starts when a local worker runs; queued work waits for a slot. Existing memory, network, state-space and output limits remain in force. The service retains at most 32 jobs and evicts the oldest completed job when admitting another. Save projects for permanent archival.

By default, a fixed-port service stores original requests and completed results under the current user's local application data, in `VisualDsdRebooted/jobs-<port>`. Choose a dedicated directory with `serve --jobs-dir PATH`. It contains model sources, sequence databases and imported observation data; protect it as you would the project files. Port `0` is ephemeral unless a directory is explicitly provided. One service can own a directory at a time. Writes use atomic file replacement. After an unexpected service stop, unfinished local jobs become **interrupted** and are not silently rerun; completed results remain available. Graceful service shutdown cancels its workers.

## Optional remote compute

A second copy of the standalone application can run calculations on another computer or a cloud VM. The workspace remains local and forwards requests to that explicitly configured service. This is a portable compute service; the original Azure Batch pool/account/package-management integration is not implemented. CI verifies two local application processes, authentication, cancellation, restart recovery and output equivalence; no cloud account deployment or provider billing has been tested.

Use the same engine version on both machines. Compute mode listens on loopback and requires a shared random secret of 32–4096 characters. Set secrets through the service environment; they are never written into models, saved projects or job records. The following uses an SSH tunnel so the compute API remains bound to localhost.

On the compute machine (Linux shell; enter the shared secret at the masked prompt):

```bash
read -rsp 'Compute token: ' VISUAL_DSD_COMPUTE_TOKEN
export VISUAL_DSD_COMPUTE_TOKEN
./VisualDsd compute --port 5800 --jobs-dir ./compute-jobs
```

On the desktop, keep a tunnel running in another terminal, replacing the SSH destination with your compute machine:

```bash
ssh -N -L 5801:127.0.0.1:5800 user@compute-host
```

Start the local workspace from PowerShell 7, entering the same secret:

```powershell
$env:VISUAL_DSD_REMOTE_URL = 'http://127.0.0.1:5801/'
$env:VISUAL_DSD_REMOTE_TOKEN = Read-Host 'Compute token' -MaskInput
.\VisualDsd.exe serve --jobs-dir .\workspace-jobs
```

The header displays **Remote compute**. Only authenticated requests reach compute endpoints. The desktop accepts an HTTPS origin or a loopback HTTP origin, rejects redirects and version mismatches, and keeps the remote identifier after admission. If a submission response is lost, its outcome is reported as unknown and it is not retried. If an existing job's connection fails, **Resume connection** reconnects to that identifier without resubmission. Known remote jobs reconnect after a workspace service restart. An unconfirmed remote cancellation is reported explicitly because the remote calculation may still be running. Remove the two `VISUAL_DSD_REMOTE_*` variables before starting the workspace to return to local computation.

## Test a logic circuit

Choose **Logic experiment** on the start page or toolbar. **Try a three-level Seesaw circuit** loads a ready experiment for `(A OR B) AND C`, followed by a restored OR buffer. Its original generated DSD source, compiler URL, input netlist and SHA-256 are included. **Run all input cases** evaluates all eight combinations; each row opens its own concentration curves.

For your assignment, use the Seesaw Compiler's **Visualize and simulate with DSD** export and open that generated file. A Seesaw netlist is a different language. Check the model, then select the input/output molecular structures and enter the expected Boolean functions (`NOT`, `AND`, `XOR`, `OR`, parentheses). Configure the physical OFF/ON concentrations, exact source units, read time and low/high thresholds. No threshold is assumed to work for every circuit.

Runs use Oslo deterministically and support 1–4 logical inputs, 1–4 outputs and optional complementary rails. Between thresholds is **unknown**. For dual rails, only `(1,0)` and `(0,1)` give a definite bit. Missing/failed/timed-out simulations are separate from unknown logical values. Readout uses linear interpolation between completed samples, without extrapolation. Source sweeps, named batches, JIT and scheduled/spatial inputs must be handled in the full workspace instead.

Select **Inspect case**, then choose a logic input/output, molecular card, curve or curve label. The same physical signal is highlighted across the views. **Focus selected traces** rescales the chart to that selection; **Show all traces** restores the complete case. New batches record both input and output rails, up to 16 distinct molecular traces. Input bits specify starting concentrations; those molecules may be consumed. Internal Boolean nodes show the entered expected function, not inferred Seesaw compiler stages, and have no automatic molecular mapping.

**Signal quality & response** uses a configurable measurement window, initially zero to the experiment read time. Changing the window recalculates from saved trajectories without resubmitting jobs. Each definition is also available beside the results:

| Metric | Definition |
| --- | --- |
| OFF-rail peak (leakage) | Largest saved/interpolated concentration of the rail intended to remain OFF in the window. A single-rail ON case has no OFF rail, so this is not applicable; a dual-rail case measures its complementary OFF rail |
| Threshold margin | At the experiment read time: OFF = low threshold minus concentration; ON = concentration minus high threshold. Dual rails use the smaller required margin. Zero is accepted; negative values violate a required threshold |
| Sustained response delay | Last entry into the expected threshold region that stays valid through the window end, measured from the window start. Already valid throughout gives zero; invalid at the end gives **not reached** |

The summary reports measurement coverage and the worst measured cases, excluding unavailable simulations. These calculations use linear interpolation and cannot detect transients between saved samples; response delay is a threshold settling measure rather than a 10–90% rise time. **Metrics CSV** retains full numeric precision, units, window, thresholds and job provenance. Older projects without input trajectories remain readable and explicitly show missing input traces.

**Save project & trajectories** preserves the source snapshot, mappings, expected function, settings, engine version, job IDs and completed curves. **Truth table CSV** exports the comparison. Reopening a project recalculates the interpretation from saved curves; editing the source or experiment marks the earlier batch stale. Reloading pauses submission of new cases; **Continue unfinished cases** reconnects to an admitted job before proceeding. An ambiguous submission is never automatically repeated. Stop leaves unsubmitted cases available for an explicit continuation. Save before replacing an experiment batch.

### Biological sequence workbench

Open **Sequences** in the toolbar or **Open sequence workbench** on Start. Import multi-record FASTA with an explicit DNA/RNA/protein alphabet, or annotated GenBank records. Inspect one-based feature coordinates and a paged sequence view, calculate called-base GC and ambiguity bounds, reverse complement, transcribe the displayed coding strand, and translate any of six frames with NCBI tables 1, 2 or 11. Complete-CDS mode validates initiation and termination separately from ordinary frame translation.

Conversions create independent records with the input digest and selected settings. Source annotations remain on the original record. Both the main project and a standalone sequence-workspace JSON preserve these documents; sequence ZIP exports include typed FASTA, GenBank, original imported GenBank text and conversion settings. Remote/unsupported feature locations remain labelled, and annotation exceptions and splicing are not inferred. English and Persian guidance and authored examples are built in. Limits: 100 records, 200000 symbols per record, 1000000 total symbols and 8 MiB including annotations.

### Compare conditions and random repeats

In **Compare conditions & stochastic repeats**, configure up to four conditions with ON/OFF input multipliers and optional named parameter assignments, one `name=value` per line. Named overrides must refer to declared model parameters; local `let`/`def` constants are not parameter declarations. DSD parameters are applied before module/domain expansion. The source text is preserved. Conditions retain the same units, read time and thresholds, and the earlier truth-table batch remains independent.

Choose deterministic **Oslo** with one repeat, or **SSA** with 1–8 repeats and an explicit base seed. The total is limited to 64 case simulations. Each repeat adds 16 to the base seed and each input case adds its zero-based index; matching conditions share repeat seeds for paired comparisons. SSA uses the source model's stochastic scaling. Comparisons require one trajectory and no source reaction-step limit; the plan manages repeats. The terminal sample is recorded only after the solver reaches the requested final time. Saved SSA curves use the last recorded value between samples, rather than interpolating a continuous concentration. A finite sample grid can miss intervening events.

Inspect individual curves and per-condition/case/output means and sample standard deviations. Sample SD uses `n−1` and is unavailable for fewer than two completed measurements. Unknown logical values, execution failures and response delays not reached by the window end are counted separately; unavailable data never become zeros. Reached-delay means exclude not-reached delays and show their measurement count. Simulation repeats are not biological replicates or evidence of wet-lab reliability. **Comparison CSV** preserves each case's seed, overrides, observed state, metrics and job provenance. Continue unfinished comparisons explicitly after a reload; an ambiguous admission is never automatically repeated.

## Explore feedback and Adleman's algorithm

The Start page offers **Open feedback lesson**. Its four-reaction mass-action CRN compares an open loop (`feedback=0`) and a closed negative autoregulation loop (`feedback=1`) with matched initial conditions and rates. The protein binds a promoter and reduces subsequent production; free and bound promoter populations sum to a conserved total. The reactions define an illustrative gene-regulation model, not a Seesaw DNA design or an experimentally fitted circuit. Transcription delay, cell growth and resource competition are absent. Research PI-controller examples from the original collection remain separately available.

**Open Adleman lab** is an independent algorithmic lesson inspired by [Adleman's 1994 paper](https://doi.org/10.1126/science.7973651). Define a directed graph with 2–7 vertices, generate candidate walks, select endpoints and vertex-count length, and filter for every vertex. The supplied graph is our teaching example. Enumeration is exhaustive for walk lengths 1 through `n+1`, is exponential, and stops with an explicit error above 16,000 candidates; a truncated search never claims absence of a path. The model assumes perfect generation and selection and models no physical DNA sequences, chemistry, errors, yields or concentrations. It does not reproduce a laboratory protocol or claim constant-cost physical computation. Save and reopen its independent lab JSON, or export a report and ZIP containing every filter's retained walks.

## Prepare an exercise report

Choose **Exercise report** in the toolbar or logic dialog. Enter your name, question, interpretation and limitations; these notes persist with the project and do not invalidate scientific results. Select the workspace calculation or logic experiments/comparisons as the report scope. The application does not supply a student's conclusion.

Download the self-contained HTML and use the browser's Print command to print or save as PDF. **Download exercise ZIP** includes the project, report, source snapshots, exact settings, notes, CSV data and SVG plots. Report plots may subsample dense traces; CSV retains every returned sample. Failed or absent calculations remain explicit, and a changed source is labelled as an earlier snapshot. The Adleman lab has its own report and exercise package. Reports and packages work offline and do not upload work to a service.

## Command line

The same executable supports structured JSON output for scripts. These examples use Linux shell notation; on Windows use `.\VisualDsd.exe`.

```bash
./VisualDsd --help
./VisualDsd parse model.dsd
./VisualDsd expand model.dsd --compilation detailed
./VisualDsd parse model.dsd --toeholds toeholds.txt --specificities specificities.txt --dsd-options options.json
./VisualDsd simulate model.dsd --simulator oslo --final 100 --points 200
./VisualDsd simulate model.dsd --simulator ssa --seed 42
./VisualDsd simulate model.crn --simulator sundials
./VisualDsd simulate model.crn --simulator cmesundials
./VisualDsd simulate model.crn --simulator mc
./VisualDsd infer model.dsd --data observations.csv --seed 42
./VisualDsd synthesize model.crn --phase-trajectories 8
./VisualDsd export model.crn --simulator oslo
./VisualDsd analyze model.dsd
./VisualDsd simulate model.crn --node prediction --system reversible
./VisualDsd parse model.txt --language crn
```

Input may be a file or `-` for standard input. Use `--dialect legacy` explicitly when needed; `.vdsd` files select the legacy dialect automatically. Repeat `--data` for multiple CSV datasets: each file's stem identifies the dataset referenced by the model. Inference also requires the model's inference, prior, and data directives.

`--dsd-options` reads a JSON object of explicit overrides, for example `{"leaks": false, "renderer": "branches", "renderMode": "nucleotides"}`. Omitted fields use source settings; unknown fields and invalid values are rejected. Sequence database and options files are limited to 256 KiB each.

Responses contain `success`, the requested operation, results when available, and structured diagnostics. A successful calculation exits with `0`; calculation failures return `1`, invalid command/input returns `2`, and cancellation returns `130`.

## Build & test

Development requires the [.NET SDK pinned in `global.json`](global.json), [PowerShell 7](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell), and [Node.js 22](https://nodejs.org/en/download) for the JavaScript tests. On Linux, `libgomp.so.1` is also required by Z3. Native solver builds also require CMake and a C/C++ compiler: Visual Studio Build Tools with **Desktop development with C++** and **CMake tools** on Windows, or CMake and GCC on Linux. They are built automatically from checksum-verified, vendored SUNDIALS 3.1.2 sources; downloaded applications include these solvers and need no compiler or separate SUNDIALS installation.

Z3 is pinned to the official `Microsoft.Z3` 4.12.2 package. The first Linux build also downloads its matching official native library through `eng/z3.ps1`, checking the archive and library SHA-256 hashes. Downloaded applications include Z3 and require no separate solver or Python installation.

Node.js is only a test dependency; the application has no npm installation or frontend build step.

```powershell
git clone https://github.com/parhamKIY/Visual-DSD-rebooted.git
cd Visual-DSD-rebooted

# Windows: install the pinned SDK locally if it is missing.
pwsh ./eng/bootstrap.ps1

# Start the application from source.
pwsh ./eng/run.ps1
```

On Linux, install the SDK specified in `global.json` before running the scripts; the bootstrap helper installs the Windows x64 SDK. The first build needs network access to restore packages. Packages and local tools stay in the ignored `.tooling/` directory.

Run the reference checks, engine tests, application tests, and JavaScript tests:

```powershell
pwsh ./eng/test.ps1 -Locked
pwsh ./eng/test-ui.ps1
```

Produce a self-contained executable and check it on its target operating system:

```powershell
# Windows x64
pwsh ./eng/publish.ps1 -Runtime win-x64
pwsh ./eng/smoke.ps1 -Runtime win-x64

# Linux x64, on Linux
pwsh ./eng/publish.ps1 -Runtime linux-x64
pwsh ./eng/smoke.ps1 -Runtime linux-x64
```

Executables are written to `artifacts/publish/<runtime>/`. GitHub Actions runs the same checks on Windows and Linux, then packages the verified executable with its notices and checksum. Test results are uploaded separately.

### Publish a classroom release

After the current `master` commit passes **Engine baseline** on both platforms, run **Publish verified classroom release** under Actions. Supply the application version and successful baseline run ID. The workflow validates the commit, both platform jobs, package hashes, archive contents and build metadata before creating a tag and draft. It publishes only after the uploaded hashes match; existing releases are not overwritten.

To package a local published application, use `./eng/package.ps1 -Runtime win-x64`. Package and release validation tests run with `python -m unittest discover -s tests/Release -v`.

### Repository layout

```text
src/         Modern application, engine adapter, and maintained scientific core
tests/       Engine, application, browser-data, and compatibility tests
reference/   Independent build of the preserved original implementation
upstream/    Frozen source snapshot and file-hash manifest
eng/         Bootstrap, run, verification, and publishing scripts
native/      Portable native solver wrapper and preserved SUNDIALS sources
```

## Compatibility & scope

The reconstruction preserves a frozen snapshot of **702 original files** and checks **300 recorded reference cases**: 255 baseline cases and 45 additional network/trajectory cases. Reference results are regenerated by the independent original-source build and compared without overwriting the recorded expectations. An additional 17 original StabilityZ3 source files are preserved separately in `upstream/stability-z3`, with their own checksum manifest. The maintained solver adapts native packaging, current Z3 tactics, witness extraction, invariant numeric encoding and resource cleanup; Python-based equilibrium model reduction is excluded from this standalone path. The snapshot identifies its source repository; the supplied source tree did not include an upstream commit identifier.

These checks establish compatibility for the cases they exercise. They do not establish complete feature parity or experimental scientific validity. Thirteen legacy inputs retain explicitly recorded unsupported outcomes, and one inherited upstream test remains skipped.

The final acceptance suite also checks the **public application output** for all 300 reference cases: 287 successful networks and 13 original unsupported outcomes. It compares initial populations (including constants, timed contributions and spatial fields), molecular structures, reaction participants and multiplicities, forward/reverse rates, SVG availability and exported CRN settings. Twenty Oslo/seeded-SSA trajectories are compared against independently recorded original results, including legacy migration and Rules DSD. All 108 shipped original examples have catalogue coverage; this is source/parse coverage, not a claim that all 108 have been expanded or simulated.

The same generated public JSON is then checked by the browser's actual project reader and saved-project roundtrip on Windows and Linux. Invalid reaction references and failed results must be rejected by that reader. Frozen expectations are never regenerated from rebooted output. Associative expression grouping is normalized on both sides of the public initial-population comparison; core reference comparisons retain their original strict structural checks.

| Area | Acceptance evidence | Remaining scope |
| --- | --- | --- |
| DSD languages and compilation | Frozen-source reference reproduction, all four compilation modes, legacy conversion, Rules DSD, public network comparisons | Thirteen old converter inputs remain unsupported by the original reference as well |
| Simulators and state exploration | Original Oslo/SSA trajectories; analytic, conservation, distribution and covariance checks; native solver and bounded graph tests | Interactive limits and solver-specific restrictions listed below still apply |
| Inference and synthesis | Seeded fits, multiple chains, linked graph priors, Z3 witnesses, residual/Jacobian checks and failure cases | No experimental validation; Python equilibrium reduction is excluded |
| Scientific exports | Independent libSBML checks and equation integration; Linux Octave execution, including moment closure | Scheduled inputs are retained in CRN source and diagnosed in unavailable formats |
| Workspace and job execution | Project roundtrips, original library hashes, process isolation, restart recovery, cancellation and authenticated two-service tests | Original Azure Batch administration is replaced by portable compute; real cloud deployment is untested |

Current boundaries:

- Parameter synthesis is bounded to 1–8 species, 128 reactions and 32 parameters in one selected system, with rational rates and integer powers from -16 to 16. Sweeps, named simulation batches, timed/spatial initials and Python-based equilibrium model reduction are unavailable on this path. Whole-request time and memory limits still apply.
- Just-in-time models use SSA; full-network expansion and inference are unavailable for that mode. State exploration uses the same reaction calculus lazily, including Rules DSD and explicit reactions; it requires nonconstant integer populations, time-independent rates, scale=1, and no timed population inputs.
- Inference supports Oslo and Sundials, 1–4 distinct chain seeds per node, joint fitting of observed systems within a node, and sequential fitting of linked model nodes. Use the **CRN · linked inference** example to try the complete flow with included synthetic observations. Fitting executes the whole graph; the selected node controls the initial result view. Use **Fitted model node** to inspect other completed fits.
- Configure multiple chains using the original syntax, for example `directive inference {burnin=200; samples=400; thin=10; seeds=[11;29]}`. Clear the UI seed override when using a seed list. `lowerbound` includes only chains whose maximum log likelihood is strictly greater than the bound; excluded chains remain available in result JSON, traces and CSV. Pooled means, variances and intervals are recomputed from retained draws, and the fit curve comes from the best included chain. Different random seeds share the declared initial parameter values.
- Posterior views include chain traces, marginal density histograms and joint parameter draws. CSV exports preserve each chain seed, inclusion flag, recorded iteration, log likelihood, log prior and parameter draws. Saved projects preserve the selected node and posterior parameters. The displayed [classical split R-hat](https://mc-stan.org/docs/2_31/reference-manual/notation-for-samples-chains-and-draws.html) uses the unranked draws; it is not the modern rank-normalized diagnostic or a convergence guarantee, and is omitted when it is undefined.
- Parameter links preserve the original `Fixed`, `Normal`, `LogNormal` and `TruncatedNormal` syntax. They transfer posterior summaries, not the full joint distribution between nodes. Effective priors are retained in each result. Log-normal transfer reconstructs the source mean and variance using the corrected log-scale standard deviation. Ambiguous multiple incoming priors are rejected. At least one variable model or noise parameter is required at every fitted node.
- Each inference request is bounded to eight nodes, four chains per node, 20000 total burn-in plus sampling iterations, 20000 selected measurements and 200000 posterior values. Each chain retains 2–500 draws. Dataset declarations must account for every imported dataset; each observed system keeps its own plots, units, simulation settings and network. Long calculations remain subject to the worker deadline.
- CME, LNA, spatial simulation, and state exploration enforce explicit size and work limits. Large models may require a smaller grid, state space, or output request.
- Native `sundials` uses CVODE 3.1.2, preserving the original Adams/BDF selection through `directive deterministic {stiff=false}` / `stiff=true`. `cmesundials` uses the same bounded state enumeration as managed CME (at most 4096 states, or 2048 with a dense stiff solver).
- Moment closure uses the original symbolic equations, derivative-matching closure, and Oslo integration. Configure it with `directive simulator mc` and `directive moments {order=2; plots=[<A>; <A^2>]; initial_minimum=1e-16; log_evaluation=false}`. It supports mass-action reactions, order 1–8 and at most 256 moments; constant species, timed inputs and stochastic scale other than 1 are rejected. Standard deviations are available for first moments when order is at least 2; uncomputed uncertainties are omitted. It approximates nonlinear networks, and the original visualization clamps negative variance estimates to zero. Output interpolation can introduce additional error between solver steps.
- LNA and CME accept a finite positive stochastic `scale` and preserve the original CRN convention: reported values are scaled copy populations. CME requires the scaled initials to be integers. LNA supports mass-action reactions and affine species plots (sums, differences and constant multiples); their uncertainty uses the full covariance matrix. Nonlinear LNA plots are rejected rather than assigned misleading uncertainties. LNA is limited to 128 species, 200000 output values per run, and 2048 integrated covariance-system variables when using the dense stiff solver. Both solvers reject timed population inputs; CME also rejects constant species and time-dependent reaction rates.
- Spatial simulation supports grids of 4–512 points in 1D or 4–128 points per side in 2D, up to 128 species and 5000 integration output intervals. The existing budget of 200000 grid values and integration-work limits still applies. Explicit nonuniform output times use linear interpolation between integration output frames; increase `points` to refine that interpolation. Named rates can be used in spatial plots. Large 1D heatmaps average adjacent samples for display; project files and CSV retain all output frames.
- CME and CMESundials return the full joint state distribution, including species correlations. Arbitrary finite plot expressions are evaluated in each reachable joint state, so nonlinear means and uncertainties are expectations over the distribution. The probability view computes marginals from those states; its slider and CSV use exact output samples. The heatmap averages adjacent samples when needed for display. Solver roundoff corrections are limited to a mass residual of `1e-5`; invalid distributions fail explicitly. Probability results are limited to 200000 state values per batch. Older projects without probability output remain readable.
- No temporal-logic model-checking result is claimed. The supplied original source contains old query examples and commented-out PRISM/MRMC export code; it does not provide an active temporal-query server operation. A separate model-checking integration would be additional work.

## Origins & license

Built from Microsoft's [CRN Engine / Visual DSD](https://github.com/microsoft/CRN), with the original source preserved for comparison and regression testing.

Distributed under the [MIT license](LICENSE). Original copyright and third-party acknowledgements are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE). This repository is an independent modernization of that codebase.

For local Windows maintenance, activate a verified package with `./eng/activate-local.ps1 -Package <zip>`. It checks the checksum, payload, source commit and executable version, installs the canonical `artifacts/publish/win-x64/VisualDsd.exe`, retains one ZIP in `artifacts/releases/current`, and removes recognized older local build/package copies. Close running local builds first. Unknown files stop cleanup; source, jobs and project files are outside its cleanup scope. GitHub release history remains available.
