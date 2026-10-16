namespace VisualDsd.Rebooted.Baselines

open System
open System.IO
open System.Security.Cryptography
open System.Text
open System.Text.Json
open Microsoft.Research.DNA
open Microsoft.Research.CRNEngine

[<CLIMutable>]
type CaseSpec = {
    Id: string
    Operation: string
    Dialect: string
    Source: string
    Semantics: string
    ExpectedStatus: string
}

[<CLIMutable>]
type Snapshot = {
    Status: string
    Dialect: string
    Kind: string
    Compilation: string
    Jit: bool
    Initials: string array
    Reactions: string array
    Settings: string
    DsdOptions: string
    SvgCount: int
    Times: float array
    Columns: string array
    Values: float array array
    ErrorType: string
    Error: string
}

[<CLIMutable>]
type GoldenCase = { Spec: CaseSpec; SourceSha256: string; Expected: Snapshot }

[<CLIMutable>]
type GoldenFile = {
    SchemaVersion: int
    ReferenceManifestSha256: string
    Cases: GoldenCase array
}

module Snapshots =
    let jsonOptions = JsonSerializerOptions(WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true)

    let sha256 path = File.ReadAllBytes path |> SHA256.HashData |> Convert.ToHexString |> fun s -> s.ToLowerInvariant()

    let referenceManifestHash repoRoot =
        File.ReadAllText(Path.Combine(repoRoot, "upstream", "snapshot.json")).Replace("\r\n", "\n")
        |> Encoding.UTF8.GetBytes
        |> SHA256.HashData
        |> Convert.ToHexString
        |> fun hash -> hash.ToLowerInvariant()

    let rec findRoot (directory: DirectoryInfo) =
        if isNull directory then failwith "Repository root was not found."
        elif File.Exists(Path.Combine(directory.FullName, "upstream", "snapshot.json")) then directory.FullName
        else findRoot directory.Parent

    let root () = findRoot (DirectoryInfo AppContext.BaseDirectory)
    let sourcePath repoRoot (spec: CaseSpec) = Path.Combine(repoRoot, spec.Source.Replace('/', Path.DirectorySeparatorChar))

    let private empty = {
        Status = "pass"; Dialect = ""; Kind = ""; Compilation = ""; Jit = false
        Initials = [||]; Reactions = [||]; Settings = ""; DsdOptions = ""; SvgCount = 0
        Times = [||]; Columns = [||]; Values = [||]; ErrorType = ""; Error = ""
    }

    let private normalise (text: string) = text.Replace("\r", "").Replace("\n", "").Replace("\t", "")

    let capture repoRoot (spec: CaseSpec) =
        Globalization.CultureInfo.CurrentCulture <- Globalization.CultureInfo.InvariantCulture
        Globalization.CultureInfo.CurrentUICulture <- Globalization.CultureInfo.InvariantCulture
        let input = File.ReadAllText(sourcePath repoRoot spec)
        let dialect =
            if spec.Dialect = "auto" then
                if input.Contains("//old_syntax", StringComparison.Ordinal) then "legacy" else "current"
            else spec.Dialect
        try
            let code = if dialect = "legacy" then SLConversion.convertSL input else input
            let parsed = Dsd.parse code
            let originalOptions = Dsd.get_options parsed
            let compilation =
                match spec.Semantics with
                | "default" -> Options.Default
                | "detailed" -> Options.Detailed
                | "finite" -> Options.Finite
                | "infinite" -> Options.Infinite
                | "source" -> Options.getRules originalOptions
                | unknown -> failwithf "Unknown compilation semantics: %s" unknown
            let options = Options.setRules compilation originalOptions
            let bundle = Dsd.set_options parsed options
            let jit = Dsd.is_jit bundle
            if spec.Operation <> "parse" && jit then failwith "A JIT model must not be fully expanded."
            let crn = if spec.Operation = "parse" then Dsd.convert_unexpanded bundle else Dsd.convert_expand bundle
            let structure (s: Microsoft.Research.CRNEngine.Species) =
                match Map.tryFind s.name crn.attributes with
                | Some attributes when attributes.structure <> "" -> normalise attributes.structure
                | _ -> s.name
            let value = Expression.simplify >> Expression.to_string id
            let functional = Expression.simplify >> Expression.to_string (Key.to_string structure)
            let reaction (r: Reaction<Microsoft.Research.CRNEngine.Species, Value, Functional>) =
                let ordered (entries: Mset.t<Microsoft.Research.CRNEngine.Species>) = entries |> List.sortBy (fun e -> structure e.element)
                { r with catalysts = ordered r.catalysts; reactants = ordered r.reactants; products = ordered r.products }
                |> Reaction.to_string structure value functional
            let initial (i: Initial<Microsoft.Research.CRNEngine.Species, Value>) =
                Initial.to_string structure value (fun _ -> false) i
            let model = {
                empty with
                    Dialect = dialect
                    Kind = match bundle with Dsd.ClassicDSD _ -> "classic" | Dsd.Rules _ -> "rules"
                    Compilation = string compilation
                    Jit = jit
                    Initials = crn.initials |> List.map initial |> List.sort |> List.toArray
                    Reactions = crn.reactions |> List.map reaction |> List.sort |> List.toArray
                    Settings = crn.settings.to_string functional functional
                    DsdOptions = Options.display options
                    SvgCount = crn.attributes |> Map.toSeq |> Seq.filter (fun (_, a) -> a.svg.Contains("<svg", StringComparison.Ordinal)) |> Seq.length
            }
            match spec.Operation with
            | "parse" | "expand" -> model
            | "oslo" | "ssa" ->
                let simulator = if spec.Operation = "oslo" then Simulator.Oslo else Simulator.SSA
                let simulation = {
                    crn.settings.simulation with
                        initial = 0.0; final = 100.0; points = 10
                        times = [for index in 0..10 -> float index * 10.0]
                        seed = Some 42; plots = []
                }
                let simulated = { crn with settings = { crn.settings with simulator = simulator; simulation = simulation } } |> fun c -> c.saturate_plots()
                let results = simulated.simulate_case()
                if results.Length <> 1 then failwith "The numeric baseline requires exactly one simulation."
                let table = results.Head.table
                if table.times.Length < 2 || table.columns.IsEmpty then failwith "Simulation output was empty."
                let values = table.columns |> List.map (fun c -> List.toArray c.values) |> List.toArray
                if values |> Array.collect id |> Array.exists (fun v -> not (Double.IsFinite v) || v < -1e-5) then
                    failwith "Simulation output contained nonfinite or negative values."
                if table.times |> List.pairwise |> List.exists (fun (a, b) -> b < a) then failwith "Simulation times were not ordered."
                let namedColumns = table.columns |> List.mapi (fun index c -> structure (Species.create c.name), values.[index]) |> List.sortBy fst
                { model with Times = List.toArray table.times; Columns = namedColumns |> List.map fst |> List.toArray; Values = namedColumns |> List.map snd |> List.toArray }
            | unknown -> failwithf "Unknown baseline operation: %s" unknown
        with error ->
            { empty with Status = "fail"; Dialect = dialect; ErrorType = error.GetType().FullName; Error = error.Message }

    let loadGolden repoRoot =
        File.ReadAllText(Path.Combine(repoRoot, "tests", "baselines", "engine-baselines.json"))
        |> fun text -> JsonSerializer.Deserialize<GoldenFile>(text, jsonOptions)

    let saveGolden repoRoot (golden: GoldenFile) =
        let path = Path.Combine(repoRoot, "tests", "baselines", "engine-baselines.json")
        File.WriteAllText(path, JsonSerializer.Serialize(golden, jsonOptions) + "\n")

    let equivalent (expected: Snapshot) (actual: Snapshot) =
        let structural s = { s with Times = [||]; Values = [||] }
        let close a b = Double.IsFinite a && Double.IsFinite b && abs (a - b) <= 1e-9 + 1e-6 * max (abs a) (abs b)
        let sameNumbers (a: float array) (b: float array) = a.Length = b.Length && Array.forall2 close a b
        structural expected = structural actual
        && sameNumbers expected.Times actual.Times
        && expected.Values.Length = actual.Values.Length
        && Array.forall2 sameNumbers expected.Values actual.Values
