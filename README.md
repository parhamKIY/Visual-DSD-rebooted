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
| Edit reaction networks | Standalone CRN source, multiple systems, selectable model nodes, and dependency graph inspection |
| Write models | Current and legacy Visual DSD syntax, source diagnostics, built-in examples, multiple editable models |
| Generate networks | Default, detailed, finite, and infinite compilation; species diagrams and reaction graphs |
| Simulate | Deterministic Oslo, stochastic SSA, just-in-time SSA, LNA, CME, native Sundials / CMESundials, moment closure, and bounded 1D/2D reaction–diffusion |
| Compare runs | Parameter sweeps, named runs, time-series plots, uncertainty traces, and numerical tables |
| Fit parameters | Seeded MCMC with Oslo / Sundials, multiple chains, joint system fits, linked model inference, and imported observation CSV files |
| Inspect probabilities | Joint CME probabilities, marginal population distributions, time heatmaps, logarithmic colors, and exact distribution CSV |
| Explore states | Finite population state graphs, lazy JIT state generation, reachable-state inspection, and shortest paths |
| Keep your work | Model files, project files with saved results, and CSV, SVG, and JSON exports |

Each calculation runs in a separate worker process with cancellation, a deadline, and memory limits. The workspace listens on localhost and serves its own assets; it needs no account or cloud service.

## Get the app

Verified builds are attached to successful runs of the [Engine baseline workflow](https://github.com/parhamKIY/Visual-DSD-rebooted/actions/workflows/engine.yml?query=branch%3Amaster).

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

Choose a built-in example and select **Simulate**, or paste this small model into the editor:

```text
directive simulator deterministic
directive simulation { final=100; plots=[<a^ b>] }
directive parameters [k=0.003; u=0.1]
dom a = {bind=k; unbind=u}
(10 * <a^ b> | 100 * {a^*}[b])
```

The `^` marks a toehold domain and `*` its complement. Simulation options can come from the model's directives or the workspace controls. The **Species**, **Reactions**, and **Network** views show the expanded model; the simulation view provides plots and data exports.

The example library also includes a CRN moment-closure model, catalytic and AND circuits, a legacy model, a just-in-time model, a reversible state switch, and a 2D diffusion pulse.

## Edit a reaction network

Use **+ CRN** to start a reaction network directly, or expand a strand model and select **Open expanded network as editable CRN**. The new document is independent of the strand model. `.crn` files select the CRN language automatically; use the language setting for other file extensions.

CRN programs use the original `system`, `node`, and `edge` syntax. Check the source, then select a model node and system to simulate or explore its states. The **Models** tab shows every system and parameter link. Shared and local parameters, functional rates, modules, sweeps, and system inheritance use the original model preparation. Project files preserve the complete source, graph, selection, and saved results.

Simulation runs the selected system. Fitting jointly uses each node's observed systems and follows parameter links across the whole graph. Choose a completed node in the result view to inspect its chains, fitted curves and effective priors.

## Command line

The same executable supports structured JSON output for scripts. These examples use Linux shell notation; on Windows use `.\VisualDsd.exe`.

```bash
./VisualDsd --help
./VisualDsd parse model.dsd
./VisualDsd expand model.dsd --compilation detailed
./VisualDsd simulate model.dsd --simulator oslo --final 100 --points 200
./VisualDsd simulate model.dsd --simulator ssa --seed 42
./VisualDsd simulate model.crn --simulator sundials
./VisualDsd simulate model.crn --simulator cmesundials
./VisualDsd simulate model.crn --simulator mc
./VisualDsd infer model.dsd --data observations.csv --seed 42
./VisualDsd analyze model.dsd
./VisualDsd simulate model.crn --node prediction --system reversible
./VisualDsd parse model.txt --language crn
```

Input may be a file or `-` for standard input. Use `--dialect legacy` explicitly when needed; `.vdsd` files select the legacy dialect automatically. Repeat `--data` for multiple CSV datasets: each file's stem identifies the dataset referenced by the model. Inference also requires the model's inference, prior, and data directives.

Responses contain `success`, the requested operation, results when available, and structured diagnostics. A successful calculation exits with `0`; calculation failures return `1`, invalid command/input returns `2`, and cancellation returns `130`.

## Build & test

Development requires the [.NET SDK pinned in `global.json`](global.json), [PowerShell 7](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell), and [Node.js 22](https://nodejs.org/en/download) for the JavaScript tests. Native solver builds also require CMake and a C/C++ compiler: Visual Studio Build Tools with **Desktop development with C++** and **CMake tools** on Windows, or CMake and GCC on Linux. They are built automatically from checksum-verified, vendored SUNDIALS 3.1.2 sources; downloaded applications include these solvers and need no compiler or separate SUNDIALS installation.

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

The reconstruction preserves a frozen snapshot of **702 original files** and checks **300 recorded reference cases**: 255 baseline cases and 45 additional network/trajectory cases. Reference results are regenerated by the independent original-source build and compared without overwriting the recorded expectations. The snapshot identifies its source repository; the supplied source tree did not include an upstream commit identifier.

These checks establish compatibility for the cases they exercise. They do not establish complete feature parity or experimental scientific validity. Thirteen legacy inputs retain explicitly recorded unsupported outcomes, and one inherited upstream test remains skipped.

Current boundaries:

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
- Temporal-logic model checking is not yet exposed by this application.

## Origins & license

Built from Microsoft's [CRN Engine / Visual DSD](https://github.com/microsoft/CRN), with the original source preserved for comparison and regression testing.

Distributed under the [MIT license](LICENSE). Original copyright and third-party acknowledgements are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE). This repository is an independent modernization of that codebase.
