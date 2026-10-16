namespace VisualDsd.Engine

open System
open Microsoft.Research.DNA
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module private Conversion =
    let value (expression: Value) = Expression.to_string id expression
    let rate (r: Rate<Value, Functional>) =
        match r with
        | Rate.MassAction expression -> RateData("massAction", value expression)
        | Rate.Function expression -> RateData("functional", Functional2.to_string expression)

    let participants (entries: Mset.t<Microsoft.Research.CRNEngine.Species>) =
        entries |> List.map (fun entry -> Participant(entry.element.name, entry.multiplicity)) |> List.toArray

    let reaction (r: Reaction<Microsoft.Research.CRNEngine.Species, Value, Functional>) =
        ReactionData(participants r.reactants, participants r.products, participants r.catalysts,
                     rate r.rate, r.reverse |> Option.map rate |> Option.defaultValue Unchecked.defaultof<RateData>)

    let species valueKind (crn: Crn) (initial: Initial<Microsoft.Research.CRNEngine.Species, Value>) =
        let id = initial.species.name
        let attributes = Map.tryFind id crn.attributes
        SpeciesData(id, attributes |> Option.map (fun a -> a.name) |> Option.defaultValue id,
                    attributes |> Option.map (fun a -> a.structure) |> Option.defaultValue id,
                    attributes |> Option.map (fun a -> a.svg) |> Option.defaultValue "",
                    value initial.value, initial.constant,
                    initial.time |> Option.map value |> Option.defaultValue null,
                    if valueKind = "finalPopulation" && initial.time.IsSome then "scheduledInput" else valueKind)

    let simulation (instance: Instance<Functional>) (table: Table<float>) =
        let times = table.times |> List.toArray
        if times |> Array.exists (Double.IsFinite >> not) then failwith "Simulation produced a nonfinite time."
        if times |> Array.pairwise |> Array.exists (fun (a, b) -> b < a) then failwith "Simulation times are not ordered."
        let series =
            table.columns |> List.map (fun column ->
                let values = column.values |> List.toArray
                if values.Length <> times.Length || (values |> Array.exists (Double.IsFinite >> not)) then
                    failwith "Simulation returned invalid series data."
                SeriesData(column.name, values)) |> List.toArray
        SimulationData(instance.name, instance.sweep, instance.assignment, times, series,
                       instance.settings.seed |> Option.map Nullable |> Option.defaultValue (Nullable()))

    let settings (crn: Crn) =
        let simulation = crn.settings.simulation
        let simulator = match crn.settings.simulator with Simulator.Oslo -> "oslo" | Simulator.SSA -> "ssa" | other -> other.to_string
        SettingsData(simulator, simulation.initial, simulation.final, simulation.points,
                     simulation.seed |> Option.map Nullable |> Option.defaultValue (Nullable()),
                     crn.settings.units.time.to_string, crn.settings.units.concentration.to_string)

type Engine private () =
    static member Info =
        EngineInfo("Visual DSD Rebooted", "0.4.0", [|"parse"; "expand"; "simulate"|],
                   [|"auto"; "current"; "legacy"|], [|"source"; "default"; "detailed"; "finite"; "infinite"|], [|"source"; "oslo"; "ssa"|])

    static member Execute(request: ModelRequest) : EngineResponse =
        let validation = RequestValidation.Validate request
        if validation.Length > 0 then EngineResponse(false, "", "", null, validation)
        else
            let dialect =
                if request.Dialect = "auto" then
                    if request.Code.Contains("//old_syntax", StringComparison.Ordinal) then "legacy" else "current"
                else request.Dialect
            let failure code message = EngineResponse(false, request.Operation, dialect, null, [|Diagnostic(code, message)|])
            try
                Globalization.CultureInfo.CurrentCulture <- Globalization.CultureInfo.InvariantCulture
                Globalization.CultureInfo.CurrentUICulture <- Globalization.CultureInfo.InvariantCulture
                let code = if dialect = "legacy" then SLConversion.convertSL request.Code else request.Code
                let toeholds = if isNull request.Toeholds then Options.getToeholdsText Options.default_options else request.Toeholds
                let specificities = if isNull request.Specificities then Options.getSpecificitiesText Options.default_options else request.Specificities
                let original, _ = Dsd.parse_extended toeholds specificities code
                let originalOptions = Dsd.get_options original
                let compilation =
                    match request.Compilation with
                    | "default" -> Options.Default
                    | "detailed" -> Options.Detailed
                    | "finite" -> Options.Finite
                    | "infinite" -> Options.Infinite
                    | _ -> originalOptions.rules
                let bundle = Dsd.set_options original (Options.setRules compilation originalOptions)
                let jit = Dsd.is_jit bundle
                if request.Operation = "expand" && jit then
                    failure "JIT_EXPANSION" "This model requires just-in-time simulation and cannot be fully expanded."
                else
                    let unexpanded = Dsd.convert_unexpanded bundle
                    let simulator =
                        match request.Simulator with
                        | "oslo" -> Simulator.Oslo
                        | "ssa" -> Simulator.SSA
                        | _ -> unexpanded.settings.simulator
                    let updateSimulation (current: Simulation_settings<'a>) = {
                        current with
                            initial = if request.Initial.HasValue then request.Initial.Value else current.initial
                            final = if request.Final.HasValue then request.Final.Value else current.final
                            points = if request.Points.HasValue then request.Points.Value else current.points
                            times = if request.Initial.HasValue || request.Final.HasValue || request.Points.HasValue then [] else current.times
                            seed = if request.Seed.HasValue then Some request.Seed.Value else current.seed
                    }
                    let simulation = updateSimulation unexpanded.settings.simulation
                    let activeSimulations = if unexpanded.settings.simulations.IsEmpty then [simulation] else unexpanded.settings.simulations |> List.map updateSimulation
                    if activeSimulations |> List.exists (fun sim -> not (Double.IsFinite sim.initial && Double.IsFinite sim.final)) then
                        failure "INVALID_TIME" "The model's time bounds must be finite."
                    elif request.Operation = "simulate" && (activeSimulations |> List.exists (fun sim -> sim.final <= sim.initial)) then
                        failure "INVALID_TIME_RANGE" "The model's final time must be finite and greater than its initial time."
                    elif request.Operation = "simulate" && (activeSimulations |> List.exists (fun sim -> sim.points < 1 || sim.points > 100000)) then
                        failure "INVALID_POINTS" "The model's output point count must be between 1 and 100000."
                    elif request.Operation = "simulate" && simulator <> Simulator.Oslo && simulator <> Simulator.SSA then
                        failure "UNSUPPORTED_SIMULATOR" "This build supports the managed deterministic (Oslo) and stochastic (SSA) simulators."
                    elif request.Operation = "simulate" && jit && simulator <> Simulator.SSA then
                        failure "JIT_SIMULATOR" "Just-in-time models require the stochastic simulator."
                    elif request.Operation = "simulate" && jit && (not unexpanded.settings.simulations.IsEmpty || not unexpanded.settings.sweeps.IsEmpty) then
                        failure "JIT_BATCH_UNSUPPORTED" "Named simulations and parameter sweeps are not yet supported for just-in-time models. Run each setting as a separate model."
                    else
                        let update (settings: Crn_settings<'a>) =
                            { settings with simulator = simulator; simulation = updateSimulation settings.simulation
                                            simulations = settings.simulations |> List.map updateSimulation }
                        let configured =
                            match bundle with
                            | Dsd.ClassicDSD classic -> Dsd.ClassicDSD { classic with settings = update classic.settings }
                            | Dsd.Rules rules -> Dsd.Rules { rules with settings = update rules.settings }
                        let initialCrn = if request.Operation = "parse" || jit then Dsd.convert_unexpanded configured else Dsd.convert_expand configured
                        let crn, simulations =
                            if request.Operation <> "simulate" then initialCrn, [||]
                            elif jit then
                                match Dsd.to_jit configured with
                                | Choice1Of2 state ->
                                    let finalState, table = Jit.simulate state (Dsd.makeDsdCalculus configured)
                                    let expanded = Jit.to_crn finalState initialCrn
                                    expanded, [|Conversion.simulation { Instance<Functional>.empty with settings = initialCrn.settings.simulation } table|]
                                | Choice2Of2 state ->
                                    let finalState, table = Jit.simulate state (Dsd.to_rules_calculus configured)
                                    let expanded = Jit.to_crn finalState initialCrn
                                    expanded, [|Conversion.simulation { Instance<Functional>.empty with settings = initialCrn.settings.simulation } table|]
                            else
                                let runs = initialCrn.simulate_case() |> List.map (fun result -> Conversion.simulation result.instance result.table) |> List.toArray
                                initialCrn, runs
                        if crn.initials.Length > 10000 || crn.reactions.Length > 50000 then
                            failure "MODEL_TOO_LARGE" "The expanded model exceeds the interactive result limit."
                        else
                            let model = ModelData((match configured with Dsd.ClassicDSD _ -> "classic" | Dsd.Rules _ -> "rules"),
                                                  compilation.ToString().ToLowerInvariant(), jit, Conversion.settings crn,
                                                  crn.initials |> List.map (Conversion.species (if jit && request.Operation = "simulate" then "finalPopulation" else "initial") crn) |> List.toArray,
                                                  crn.reactions |> List.map Conversion.reaction |> List.toArray, simulations)
                            EngineResponse(true, request.Operation, dialect, model, [||])
            with
            | :? Errors.DSDException as error ->
                let diagnostics = error.Errors |> Array.map (fun position -> Diagnostic("MODEL_ERROR", position.text, Nullable (position.row + 1), Nullable (position.column + 1)))
                EngineResponse(false, request.Operation, dialect, null,
                               if diagnostics.Length = 0 then [|Diagnostic("MODEL_ERROR", error.Message)|] else diagnostics)
            | :? Parser.Exception as error ->
                let diagnostics = error.Errors |> Array.map (fun position -> Diagnostic("PARSE_ERROR", position.text, Nullable position.row, Nullable (position.column + 1)))
                EngineResponse(false, request.Operation, dialect, null,
                               if diagnostics.Length = 0 then [|Diagnostic("PARSE_ERROR", error.Message)|] else diagnostics)
            | :? DllNotFoundException -> failure "NATIVE_SOLVER_UNAVAILABLE" "The requested native solver is not included in this build."
            | error ->
                let code = if error.Message.Contains("not supported", StringComparison.OrdinalIgnoreCase) then "UNSUPPORTED_FEATURE" else "MODEL_ERROR"
                failure code error.Message
