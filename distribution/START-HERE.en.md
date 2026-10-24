# Visual DSD Rebooted: first steps

1. Extract the complete ZIP into a folder you can keep. Keep LICENSE and NOTICE with the app.
2. On Windows, open VisualDsd.exe. On Linux, run `chmod +x VisualDsd` once, then `./VisualDsd`.
3. The app opens your browser at http://127.0.0.1:5800. If it does not, open that address yourself.
4. Select **Choose a guided example**, read the lesson, then **Open teaching copy**.
5. Follow the green guide: **Check model**, **Simulate**, **Review simulation**, **Download project**.
6. Check your browser downloads and keep the `.dsdproj.json` project. To reopen its source, settings and results, select **Start → Open project file**.

No SDK, Node.js, account or internet connection is required for this classroom workflow. Linux needs the operating system dependencies for .NET: https://learn.microsoft.com/dotnet/core/install/linux.

**Bring your own model:** Start → Open model file. Both current and old Visual DSD syntax are supported. The `examples` folder includes short DSD and CRN sources.

**More tools:** Select Full workspace at the top. This preserves source and settings while exposing inference, synthesis, state exploration and scientific exports. Advanced lessons open the full workspace automatically.

**Persian:** Select فارسی in the language control. Learning guides and the student journey change language; model source and the scientific engine retain their syntax and units.

**If something fails:** Read the diagnostic below the editor. Edit the source and Check again. A time limit is not a successful result. To stop an active calculation, select Stop calculation. Closing the browser does not cancel background jobs.

**Keep your work:** Browser storage is tied to this browser and address; it stores drafts, not completed results across reloads. Download a project before closing or changing computers. The service also retains a bounded job history under Jobs.

**If the app cannot connect:** Keep the app process running. Close an earlier copy if port 5800 is occupied, or start `VisualDsd.exe serve --port 5801` (Linux: `./VisualDsd serve --port 5801`) and open http://127.0.0.1:5801. A different port has separate browser storage.

`VERSION.json` identifies this build. The accompanying `.sha256` file verifies the ZIP download. Documentation and source: https://github.com/parhamKIY/Visual-DSD-rebooted.

## Logic circuit assignment

Choose **Logic experiment**, then **Try a three-level Seesaw circuit** and **Run all input cases** for a complete eight-row example. Inspect any row's curves and use **Save project & trajectories** to keep the experiment.

For your own circuit, open the DSD file produced by Seesaw's **Visualize and simulate with DSD** command, check the model, and map the molecular inputs and outputs. Set OFF/ON concentrations, exact source units, expected Boolean functions, read time and thresholds. Single and complementary dual rails are supported. **Unknown** means the signal cannot be interpreted confidently with your thresholds; execution errors are listed separately.

After reloading, new cases wait for **Continue unfinished cases**. The admitted job is reconnected, not submitted again. Experiments and completed case curves are saved in the browser when storage is available, but download a project for a durable portable copy.

Select **Inspect case** and click an input/output node, molecular drawing or curve label to follow the same signal across all views. **Focus selected traces** rescales the chart to the selection; **Show all traces** restores it. Internal Boolean gates describe your expected function and do not claim a molecular mapping.

Under **Signal quality & response**, inspect the OFF-rail peak (leakage), signed threshold margin at the read time, and sustained response delay. Open **How these metrics are calculated** for the definitions. Adjust the measurement window without rerunning, then download **Metrics CSV** or save the project. Missing simulations remain unavailable; a response that is invalid at the window end is **not reached**. Saved samples may miss short transients.

## Compare, explain and submit

In Logic experiment, use **Compare conditions & stochastic repeats** to vary input multipliers or declared parameters (`name=value`, one per line). Choose one deterministic repeat or seeded SSA repeats, with at most 64 case simulations. Inspect means, sample SD, unknown/failed cases and individual curves. Save the project before replacing a comparison; resume unfinished cases explicitly after a reload.

From Start, **Open feedback lesson** compares an illustrative open/closed gene-regulation loop. **Open Adleman lab** teaches exhaustive candidate generation and idealized filtering on a small graph; it is not a chemical or wet-lab simulation. The assumptions and model origin appear beside the activities.

Choose **Exercise report** in the toolbar or logic dialog. Write your own interpretation, then download printable HTML or the exercise ZIP. Open the HTML in a browser and use Print to print or save as PDF. The ZIP includes the project, source, recorded settings, notes, CSV and vector plots; the Adleman lab has its own JSON and package. No upload is required.

## Course exercises and systems biology

Select **Course exercises** for eleven guided activities. Each card explains its goal, route and check. The `course/COURSE.en.html` and `course/COURSE.fa.html` files in this ZIP are printable workbooks; `course/samples/` and `course/models/` contain authored inputs. The same pack can be downloaded inside the app.

Choose **Systems biology lab** for reaction conversion, promoter switching/gene expression, and open/closed feedback. Read the assumptions, write a hypothesis, then **Run ODE + SSA comparison**. Each condition gets a deterministic trajectory and 2–12 SSA repeats with recorded seeds. Select a species and individual seed, or compare the ensemble mean and sample SD. Inspect endpoint summaries, failed/unfinished runs and conservation checks. The SD band is not a confidence interval. Original SSA output can finish infinitesimally before the requested endpoint; original timestamps are retained. Coarse plotted samples do not identify every reaction event.

Save the lab JSON or **Export lab package** before changing a lesson or replacing a comparison. **Printable report** contains your notes, provenance and endpoint tables; the ZIP includes original trajectories, requests and models. **Save project** includes the lab too. Reopen a lab through **Open lab file**. Closing the dialog does not cancel admitted work; **Stop comparison** does. After reloading, explicitly choose **Continue unfinished runs** to reconnect. Unknown admissions are never automatically resubmitted; inspect Jobs.

The rates and datasets are illustrative teaching examples. Engine axes remain nM and s with scale=1 numerical populations, not a calibrated cell volume. Core exercises are offline. NCBI needs internet and MUSCLE is optional. These activities do not replace RNA-seq, NGS, proteomics or structure tools.
