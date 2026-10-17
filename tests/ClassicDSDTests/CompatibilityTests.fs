module VisualDsd.Rebooted.CompatibilityTests

open System.IO
open System.Text.Json
open Xunit
open VisualDsd.Rebooted.Baselines

let private golden () =
    File.ReadAllText(Path.Combine(Snapshots.root(), "tests", "baselines", "compatibility-baselines.json"))
    |> fun text -> JsonSerializer.Deserialize<GoldenFile>(text, Snapshots.jsonOptions)

let Cases () : seq<obj array> = (golden()).Cases |> Seq.map (fun case -> [|box case.Spec.Id|])

[<Theory>]
[<MemberData("Cases")>]
let ``expanded networks and numerical trajectories match the isolated original`` (id: string) =
    let root = Snapshots.root()
    let reference = golden()
    Assert.Equal(Snapshots.referenceManifestHash root, reference.ReferenceManifestSha256)
    let case = reference.Cases |> Array.find (fun candidate -> candidate.Spec.Id = id)
    Assert.Equal(case.SourceSha256, Snapshots.sha256 (Snapshots.sourcePath root case.Spec))
    let actual = Snapshots.capture root case.Spec
    Assert.True(Snapshots.equivalent case.Expected actual,
                sprintf "%s differs from the frozen reference: %s" id (JsonSerializer.Serialize(actual, Snapshots.jsonOptions)))

[<Fact>]
let ``compatibility catalogue covers rules legacy and every compilation mode`` () =
    let cases = (golden()).Cases
    Assert.Equal(45, cases.Length)
    Assert.Equal(18, cases |> Array.filter (fun case -> case.Spec.Operation.StartsWith("trajectory-")) |> Array.length)
    Assert.Equal(3, cases |> Array.filter (fun case -> case.Spec.Dialect = "legacy") |> Array.length)
    Assert.Equal(6, cases |> Array.filter (fun case -> case.Expected.Kind = "rules") |> Array.length)
    for semantics in ["default"; "detailed"; "finite"; "infinite"] do
        Assert.Equal(6, cases |> Array.filter (fun case -> case.Spec.Operation = "expand" && case.Spec.Semantics = semantics) |> Array.length)
