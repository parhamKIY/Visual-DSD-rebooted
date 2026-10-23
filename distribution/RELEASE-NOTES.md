Follow a logic signal from the expected circuit to its molecules and concentration curves.

- Select any input/output node, molecular card, curve or curve label to highlight the same physical signal across views. Focus selected traces to inspect small signals on their own scale.
- Record both input and output rails in new experiments, including up to 16 distinct molecules. Molecular diagrams retain the original engine rendering; Boolean internal nodes describe the entered function and do not imply a compiler-stage mapping.
- Measure the intended OFF-rail peak (leakage), signed threshold margin at the experiment read time, and sustained threshold response delay. Definitions and sampling limits are available beside the results.
- Adjust the analysis window without rerunning the model. Summaries identify worst measured cases and show coverage; failed or unavailable cases never become zero measurements.
- Export full-precision metrics CSV with units, thresholds, window and job provenance. Projects preserve input/output curves, molecular previews and the analysis window; older output-only projects remain readable.
- Keep English as the default or switch the experiment guidance to Persian.

Download and extract the ZIP for your operating system. On Windows, open VisualDsd.exe. On Linux, run `chmod +x VisualDsd` and then `./VisualDsd`. Read START-HERE.en.md or START-HERE.fa.md in the extracted folder.

Response delay is the last threshold entry sustained through the window end, measured from its start; it is not a 10–90% rise time. Metrics use saved samples and linear interpolation and cannot resolve unrecorded transients. Thresholds remain model-specific and these deterministic calculations do not establish wet-lab correctness.

This release completes the first two steps of the course project's signal-analysis stage. Repeat/parameter comparisons, feedback examples and printable reports remain later work. Classmate usability testing is deferred until the full course project is complete.
