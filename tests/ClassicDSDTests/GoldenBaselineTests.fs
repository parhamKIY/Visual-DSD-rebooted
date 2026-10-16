module VisualDsd.Rebooted.GoldenBaselineTests

open System
open System.IO
open System.Text.Json
open Xunit
open Microsoft.Research.DNA
open VisualDsd.Rebooted.Baselines

let Cases () : seq<obj array> =
    let golden = Snapshots.loadGolden (Snapshots.root())
    golden.Cases |> Seq.map (fun case -> [|box case.Spec.Id|])

[<Theory>]
[<MemberData("Cases")>]
let ``engine output matches the isolated reference`` (id: string) =
    let root = Snapshots.root()
    let golden = Snapshots.loadGolden root
    let case = golden.Cases |> Array.find (fun candidate -> candidate.Spec.Id = id)
    Assert.Equal(case.SourceSha256, Snapshots.sha256 (Snapshots.sourcePath root case.Spec))
    let actual = Snapshots.capture root case.Spec
    Assert.True(
        Snapshots.equivalent case.Expected actual,
        sprintf "%s differs from the recorded reference. Actual: %s" id (JsonSerializer.Serialize(actual, Snapshots.jsonOptions)))

[<Fact>]
let ``original snapshot remains byte identical`` () =
    let root = Snapshots.root()
    use manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "upstream", "snapshot.json")))
    let files = manifest.RootElement.GetProperty("files").EnumerateArray() |> Seq.toArray
    Assert.Equal(702, files.Length)
    for entry in files do
        let relativePath = entry.GetProperty("path").GetString()
        let path = Path.Combine(root, "upstream", "crn-engine", relativePath.Replace('/', Path.DirectorySeparatorChar))
        Assert.True(File.Exists path, sprintf "Missing original source: %s" relativePath)
        Assert.Equal(entry.GetProperty("sha256").GetString(), Snapshots.sha256 path)

[<Fact>]
let ``golden results identify the immutable original snapshot`` () =
    let root = Snapshots.root()
    let golden = Snapshots.loadGolden root
    Assert.Equal(1, golden.SchemaVersion)
    Assert.Equal(Snapshots.referenceManifestHash root, golden.ReferenceManifestSha256)
    Assert.Equal(255, golden.Cases.Length)
    Assert.Equal(13, golden.Cases |> Array.filter (fun c -> c.Expected.Status = "fail") |> Array.length)
    Assert.Equal(2, golden.Cases |> Array.filter (fun c -> c.Spec.Operation = "oslo" || c.Spec.Operation = "ssa") |> Array.length)
    for semantics in [|"default"; "detailed"; "finite"; "infinite"|] do
        Assert.Equal(3, golden.Cases |> Array.filter (fun c -> c.Spec.Operation = "expand" && c.Spec.Semantics = semantics) |> Array.length)

let private cachedEngine = LogicDSD.engine

[<Fact>]
let ``the executable test host initializes F sharp module values`` () =
    Assert.NotNull cachedEngine
    Assert.Same(LogicDSD.engine, cachedEngine)
    Assert.Contains("!", cachedEngine.domainKeywords)
