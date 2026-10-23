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
