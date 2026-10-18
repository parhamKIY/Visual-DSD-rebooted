module VisualDsd.Rebooted.PublicParityTests

open System
open System.IO
open System.Text.Json
open System.Text.RegularExpressions
open System.Text
open System.Security.Cryptography
open Xunit
open Microsoft.Research.CRNEngine
open Microsoft.Research.DNA
open VisualDsd.Contracts
open VisualDsd.Rebooted.Baselines

let private savedCatalogue = lazy (
    ["engine-baselines.json"; "compatibility-baselines.json"]
    |> List.collect (fun file ->
        JsonSerializer.Deserialize<GoldenFile>(File.ReadAllText(Path.Combine(Snapshots.root(), "tests", "baselines", file)), Snapshots.jsonOptions).Cases |> Array.toList))
let private catalogue () = savedCatalogue.Value

let Cases () : seq<obj array> = catalogue () |> Seq.map (fun case -> [|box case.Spec.Id|])
let private normalize (text: string) = text.Replace("\r", "").Replace("\n", "").Replace("\t", "")
let private value text = Expression.from_string Parser.name text
let private displayValue = Expression.simplify >> Expression.to_string id
type PublicResult = { Request: ModelRequest; Response: EngineResponse }

[<Theory>]
[<MemberData("Cases")>]
let ``public results preserve the original species reactions rates and trajectories`` (id: string) =
    let case = catalogue () |> List.find (fun case -> case.Spec.Id = id)
    let path = Snapshots.sourcePath (Snapshots.root()) case.Spec
    Assert.Equal(case.SourceSha256, Snapshots.sha256 path)
    let code = File.ReadAllText path
    // Numerical snapshots contain the expanded source network before simulation.
    let operation = if case.Spec.Operation = "parse" then "parse" else "expand"
    let request = ModelRequest(Code = code, Operation = operation, Dialect = case.Spec.Dialect, Compilation = case.Spec.Semantics)
    let response = VisualDsd.Engine.Engine.Execute request
    let results = ResizeArray<PublicResult>()
    results.Add { Request = request; Response = response }
    Assert.Equal(case.Expected.Status = "pass", response.Success)
    if not response.Success then
        Assert.Null response.Model
        Assert.NotEmpty response.Diagnostics
    else
        let model = response.Model
        Assert.Empty response.Diagnostics
        Assert.Equal(case.Expected.Dialect, response.Dialect)
        Assert.Equal(case.Expected.Kind, model.Kind)
        Assert.Equal(case.Expected.Compilation.ToLowerInvariant(), model.Compilation)
        Assert.Equal(case.Expected.Jit, model.IsJit)
        let names = model.Species |> Array.map (fun species -> species.Id, normalize species.Structure) |> Map.ofArray
        let structure (species: Species) = names.[species.name]
        // Text serialization can introduce nested associative multiplication nodes.
        // Compare both sides after the same parser/simplifier roundtrip.
        let rec simplified count expression =
            let next = Expression.simplify expression
            if next = expression || count = 0 then next else simplified (count - 1) next
        let canonicalInitial (text: string) =
            let candidates = names |> Map.toSeq |> Seq.map snd |> Seq.distinct |> Seq.sortByDescending String.length
            let species, index =
                candidates |> Seq.map (fun name -> name, text.IndexOf(" " + name, StringComparison.Ordinal))
                |> Seq.find (fun (name, index) ->
                    if index < 0 then false
                    else
                        let tail = text.Substring(index + name.Length + 1)
                        tail = "" || tail.StartsWith(" @ ", StringComparison.Ordinal) || tail.StartsWith("{ spatial = ", StringComparison.Ordinal))
            let prefix = text.Substring(0, index)
            let constant, expression = if prefix.StartsWith("constant ", StringComparison.Ordinal) then "constant ", prefix.Substring(9) else "", prefix
            constant + (value expression |> simplified 32 |> Expression.to_string (fun key -> key)) + " " + species + text.Substring(index + species.Length + 1)
        let functional = Expression.simplify >> Expression.to_string (Key.to_string structure)
        let initials = model.Species |> Array.map (fun species ->
            let initial = Initial.create(species.Constant, value species.Initial, Species.create species.Id,
                                         Option.ofObj species.Time |> Option.map value,
                                         Option.ofObj species.SpatialInitial |> Option.map (Parser.from_string Spatial_initial.parser))
            Initial.to_string structure displayValue (fun _ -> false) initial) |> Array.sort
        let expectedInitials = case.Expected.Initials |> Array.map canonicalInitial |> Array.sort
        let actualInitials = initials |> Array.map canonicalInitial |> Array.sort
        Assert.True((expectedInitials = actualInitials), sprintf "%s: initial populations differ.\nMissing: %A\nUnexpected: %A" id
                                                     (Set.difference (Set.ofArray expectedInitials) (Set.ofArray actualInitials))
                                                     (Set.difference (Set.ofArray actualInitials) (Set.ofArray expectedInitials)))
        let participants (entries: Participant[]) : Mset.t<Species> =
            entries |> Array.map (fun entry -> { Mset.element = Species.create entry.SpeciesId; Mset.multiplicity = entry.Multiplicity })
            |> Array.sortBy (fun entry -> structure entry.element) |> Array.toList
        let rate (data: RateData) =
            match data.Kind with
            | "massAction" -> Rate.MassAction (value data.Expression)
            | "functional" -> Rate.Function (Parser.from_string Functional2.parse data.Expression)
            | kind -> failwithf "Unknown rate kind: %s" kind
        let reactions = model.Reactions |> Array.map (fun data ->
            Reaction.create(participants data.Catalysts, participants data.Reactants, Option.ofObj data.ReverseRate |> Option.map rate, rate data.Rate, participants data.Products)
            |> Reaction.to_string structure displayValue functional) |> Array.sort
        Assert.True(case.Expected.Reactions = reactions, sprintf "%s: reactions differ.\n%A\n%A" id case.Expected.Reactions reactions)
        Assert.Equal(case.Expected.SvgCount, model.Species |> Array.filter (fun species -> species.Svg.Contains("<svg", StringComparison.Ordinal))
                                           |> Array.distinctBy (fun species -> if isNull species.SourceId then species.Id else species.SourceId) |> Array.length)
        // The exported CRN must retain settings that the compact UI summary does not display.
        if not (isNull model.CrnCode) then
            let restored = Crn.from_string model.CrnCode
            Assert.Equal(case.Expected.Settings, restored.settings.to_string functional functional)
        if case.Expected.Times.Length > 0 then
            let current = if case.Expected.Dialect = "legacy" then SLConversion.convertSL code else code
            let simulation = "directive simulation {initial=0;final=100;points=10;seed=42;plots=[]" +
                             (if case.Spec.Operation.StartsWith("trajectory-", StringComparison.Ordinal) then "}" else ";times=[0;10;20;30;40;50;60;70;80;90;100]}")
            let current = if Regex.IsMatch(current, @"directive simulation\s*\{") then Regex.Replace(current, @"directive simulation\s*\{[^}]*\}", simulation) else simulation + "\n" + current
            let simulator = if case.Spec.Operation.EndsWith("oslo", StringComparison.Ordinal) then "oslo" else "ssa"
            let request = ModelRequest(Code = current, Operation = "simulate", Dialect = "current", Compilation = case.Spec.Semantics, Simulator = simulator)
            let result = VisualDsd.Engine.Engine.Execute request
            Assert.True(result.Success, JsonSerializer.Serialize result)
            let run = Assert.Single result.Model.Simulations
            let close a b = Double.IsFinite b && abs (a - b) <= 1e-9 + 1e-6 * max (abs a) (abs b)
            Assert.True(run.Times.Length = case.Expected.Times.Length && Array.forall2 close case.Expected.Times run.Times, id + ": output times differ.")
            Assert.Equal(case.Expected.Columns.Length, run.Series.Length)
            let plotted = result.Model.Species |> Array.map (fun species -> species.Id, normalize species.Structure) |> Map.ofArray
            for series in run.Series do
                let column = case.Expected.Columns |> Array.findIndex ((=) plotted.[series.Name])
                Assert.True(series.Values.Length = run.Times.Length && Array.forall2 close case.Expected.Values.[column] series.Values, id + ": trajectory differs.")
            results.Add { Request = request; Response = result }
    let directory = Path.Combine(Snapshots.root(), "artifacts", "public-parity")
    Directory.CreateDirectory directory |> ignore
    let file = SHA256.HashData(Encoding.UTF8.GetBytes id) |> Convert.ToHexString
    let evidence = {| Id = id; SourceSha256 = case.SourceSha256; EngineVersion = VisualDsd.Engine.Engine.Info.Version; Results = results.ToArray() |}
    File.WriteAllText(Path.Combine(directory, file + ".json"), JsonSerializer.Serialize(evidence, Snapshots.jsonOptions))

[<Fact>]
let ``every shipped original example is covered by the immutable reference catalogue`` () =
    let root = Snapshots.root()
    let sources = catalogue () |> List.map (fun case -> Path.GetFullPath(Snapshots.sourcePath root case.Spec)) |> Set.ofList
    let examples = Directory.EnumerateFiles(Path.Combine(root, "upstream", "crn-engine", "ClassicDSD", "Examples"), "*", SearchOption.AllDirectories)
                   |> Seq.filter (fun path -> [".dna"; ".txt"] |> List.contains (Path.GetExtension path)) |> Seq.toArray
    Assert.Equal(108, examples.Length)
    for path in examples do Assert.Contains(Path.GetFullPath path, sources)
