module VisualDsd.Rebooted.ReferenceBaselines

open System
open System.IO
open System.Reflection
open System.Text.Json
open VisualDsd.Rebooted.Baselines
open Microsoft.Research.DNA

[<EntryPoint>]
let main arguments =
    try
        let compatibility = arguments = [|"--record-compatibility"|] || arguments = [|"--verify-compatibility"|]
        let record = arguments = [|"--record-reference"|] || arguments = [|"--record-compatibility"|]
        if not record && arguments <> [|"--verify-reference"|] && not compatibility then
            failwith "Usage: ReferenceBaselines --record-reference | --verify-reference | --record-compatibility | --verify-compatibility"
        let repoRoot = Snapshots.root()
        let enginePath = Assembly.GetAssembly(typeof<Dsd.bundle>).Location
        let referenceRoot = Path.GetFullPath(Path.Combine(repoRoot, "reference")) + string Path.DirectorySeparatorChar
        if not (enginePath.StartsWith(referenceRoot, StringComparison.OrdinalIgnoreCase)) then
            failwith "Recording requires the isolated reference engine."
        let specs =
            File.ReadAllText(Path.Combine(repoRoot, "tests", "baselines", (if compatibility then "compatibility-cases.json" else "cases.json")))
            |> fun text -> JsonSerializer.Deserialize<CaseSpec array>(text, Snapshots.jsonOptions)
        let cases =
            specs |> Array.map (fun spec ->
                let snapshot = Snapshots.capture repoRoot spec
                if snapshot.Status <> spec.ExpectedStatus then
                    failwithf "Reference case %s expected %s, received %s: %s" spec.Id spec.ExpectedStatus snapshot.Status snapshot.Error
                { Spec = spec; SourceSha256 = Snapshots.sha256 (Snapshots.sourcePath repoRoot spec); Expected = snapshot })
        let golden = {
            SchemaVersion = 1
            ReferenceManifestSha256 = Snapshots.referenceManifestHash repoRoot
            Cases = cases
        }
        if record then
            if compatibility then
                File.WriteAllText(Path.Combine(repoRoot, "tests", "baselines", "compatibility-baselines.json"), JsonSerializer.Serialize(golden, Snapshots.jsonOptions) + "\n")
            else Snapshots.saveGolden repoRoot golden
            printfn "Recorded %d reference cases (%d expected unsupported inputs)." cases.Length (cases |> Array.filter (fun c -> c.Expected.Status = "fail") |> Array.length)
        else
            let expected =
                if compatibility then File.ReadAllText(Path.Combine(repoRoot, "tests", "baselines", "compatibility-baselines.json")) |> fun text -> JsonSerializer.Deserialize<GoldenFile>(text, Snapshots.jsonOptions)
                else Snapshots.loadGolden repoRoot
            if expected.ReferenceManifestSha256 <> golden.ReferenceManifestSha256 || expected.Cases.Length <> cases.Length then
                failwith "The reference snapshot or case catalogue differs from the recorded baseline."
            Array.iter2 (fun saved actual ->
                if saved.Spec <> actual.Spec || saved.SourceSha256 <> actual.SourceSha256 || not (Snapshots.equivalent saved.Expected actual.Expected) then
                    failwithf "Frozen reference no longer reproduces case %s." actual.Spec.Id) expected.Cases cases
            printfn "Verified %d frozen reference cases without updating recorded results." cases.Length
        0
    with error ->
        eprintfn "%s" error.Message
        1
