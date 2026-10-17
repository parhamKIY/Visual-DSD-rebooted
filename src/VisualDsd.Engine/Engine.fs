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
                    if initial.spatial.IsSome then "spatial" elif valueKind = "finalPopulation" && initial.time.IsSome then "scheduledInput" else valueKind)

    let settings (crn: Crn) =
        let simulation = crn.settings.simulation
        let simulator = match crn.settings.simulator with Simulator.Oslo -> "oslo" | Simulator.SSA -> "ssa" | other -> other.to_string
        SettingsData(simulator, simulation.initial, simulation.final, simulation.points,
                     simulation.seed |> Option.map Nullable |> Option.defaultValue (Nullable()),
                     crn.settings.units.time.to_string, crn.settings.units.concentration.to_string)

    let network valueKind (crn: Crn) =
        if crn.initials.Length > 10000 || crn.reactions.Length > 50000 then
            raise (ExecutionFailure("MODEL_TOO_LARGE", "The expanded model exceeds the interactive result limit."))
        let seen = System.Collections.Generic.HashSet<string>(StringComparer.Ordinal)
        let entries = crn.initials |> List.mapi (fun index initial ->
            let entry = species valueKind crn initial
            let first = entry.ValueKind <> "scheduledInput" && seen.Add entry.Id
            if entry.ValueKind = "scheduledInput" || not first then
                let kind = if entry.ValueKind = "scheduledInput" then "scheduledInput" elif initial.time.IsSome then "timedInput" else "initialContribution"
                SpeciesData(sprintf "initial:%d:%s" index entry.Id, entry.Name, entry.Structure, entry.Svg,
                            entry.Initial, entry.Constant, entry.Time, kind, entry.Id)
            elif initial.time.IsSome && entry.ValueKind = "initial" then
                SpeciesData(entry.Id, entry.Name, entry.Structure, entry.Svg, entry.Initial, entry.Constant, entry.Time, "timedInput")
            else entry)
        NetworkData(entries |> List.toArray,
                    crn.reactions |> List.map reaction |> List.toArray)

    let simulation (crn: Crn) network (instance: Instance<Functional>) (table: Table<float>) =
        let times = table.times |> List.toArray
        if times |> Array.exists (Double.IsFinite >> not) then failwith "Simulation produced a nonfinite time."
        if times |> Array.pairwise |> Array.exists (fun (a, b) -> b < a) then failwith "Simulation times are not ordered."
        let series =
            table.columns |> List.map (fun column ->
                let values = column.values |> List.toArray
                if values.Length <> times.Length || (values |> Array.exists (Double.IsFinite >> not)) then
                    failwith "Simulation returned invalid series data."
                SeriesData(column.name, values)) |> List.toArray
        let name = if String.IsNullOrEmpty instance.settings.name then instance.name else instance.settings.name
        SimulationData(name, instance.sweep, instance.assignment, times, series,
                       instance.settings.seed |> Option.map Nullable |> Option.defaultValue (Nullable()),
                       settings { crn with settings = { crn.settings with simulation = instance.settings } }, network)

    let statistical (crn: Crn) (instance: Instance<Functional>) (table: Table<Point>) =
        let means = table |> Table.map (fun point -> point.mean)
        let result = simulation crn null instance means
        let series = List.zip (result.Series |> Array.toList) table.columns |> List.map (fun (series,column) ->
            let deviations = column.values |> List.map (fun point -> point.stdev) |> List.toArray
            if deviations |> Array.exists (fun value -> not (Double.IsFinite value) || value < 0.0) then failwith "The solver returned an invalid standard deviation."
            SeriesData(series.Name, series.Values, deviations)) |> List.toArray
        SimulationData(result.Name, result.Sweep, result.Assignment, result.Times, series, result.Seed, result.Settings, null)

module private StatisticalSolvers =
    let simulate (crn: Crn) =
        let instances = crn.get_instances()
        if instances.Length > 256 then raise (ExecutionFailure("BATCH_TOO_LARGE", "A simulation batch cannot exceed 256 runs."))
        instances |> List.map (fun instance ->
            let current = { crn with settings = { crn.settings with simulation = instance.settings } } |> fun model -> model.substitute instance.environment
            if current.settings.stochastic.scale <> 1.0 then raise (ExecutionFailure("STATISTICAL_SCALE", "LNA and CME currently require stochastic scale=1."))
            if current.initials.Length > 128 then raise (ExecutionFailure("MODEL_TOO_LARGE", "Statistical solvers currently support at most 128 species."))
            if current.settings.simulation.plots |> List.exists (function Expression.Key (Key.Species _) -> false | _ -> true) then
                raise (ExecutionFailure("STATISTICAL_PLOTS", "LNA and CME require single-species plots; statistics for compound expressions are not supported."))
            let env = Parameters.to_env current.settings.parameters
            let eval = Expression.eval (Environment.find env)
            if current.initials |> List.exists (fun initial -> initial.time |> Option.exists (fun time -> eval time <> current.settings.simulation.initial)) then
                raise (ExecutionFailure("STATISTICAL_EVENTS", "Timed population inputs are not supported by LNA and CME."))
            let table =
                if current.settings.simulator = Simulator.LNA then current.to_lna().simulate()
                else
                    if current.initials |> List.exists (fun initial -> initial.constant || let value = eval initial.value in not (Double.IsFinite value) || value < 0.0 || value > float Int32.MaxValue || Math.Round value <> value) then
                        raise (ExecutionFailure("CME_INITIALS", "CME requires finite nonnegative integer populations and does not support constant species."))
                    // Resolve this run's parameters before enumerating states, including zero-rate transitions.
                    let inlineParameters key = match key with Key.Parameter name -> Expression.Float (Environment.find env name) | other -> Expression.Key other
                    let current = { current with reactions = current.reactions |> List.map (Reaction.map id (eval >> Expression.Float) (Expression.expand inlineParameters))
                                                 settings = { current.settings with rates = current.settings.rates |> Map.map (fun _ expression -> Expression.expand inlineParameters expression) }
                                                 initials = current.initials |> List.groupBy (fun initial -> initial.species) |> List.map (fun (_, entries) -> { entries.Head with value = Expression.Float (entries |> List.sumBy (fun initial -> eval initial.value)); time = None }) }
                    let calc, initial, reactions, adapter = current.initialise_ctmc()
                    let states =
                        try calc.to_ctmc_bounded 1000 (Hashtable.ofMap current.settings.rates) 1.0 initial reactions adapter
                        with error when error.Message.StartsWith("State space exceeds", StringComparison.Ordinal) -> raise (ExecutionFailure("STATE_SPACE_LIMIT", error.Message))
                    let cme = current.to_cme states
                    Cme.simulate env (Crn.to_inlined_rates current.settings) false cme |> snd
            Conversion.statistical current instance table) |> List.toArray

module private CrnExecution =
    let run (request: ModelRequest) (crn: Crn) =
        let noInference = Unchecked.defaultof<InferenceData>
        match request.Operation with
        | "infer" ->
            let fitted, results, details = ParameterInference.run request crn
            fitted, results |> List.map (fun result -> Conversion.simulation fitted null result.instance result.table) |> List.toArray, details
        | "analyze" ->
            let runs = Exploration.analyze crn |> Array.map (fun (instance, states) ->
                let run = Conversion.simulation crn null instance { Table.times = []; columns = [] }
                SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, run.Series, run.Seed, run.Settings, null, null, states))
            crn, runs, noInference
        | "simulate" ->
            if crn.get_instances().Length > 256 then raise (ExecutionFailure("BATCH_TOO_LARGE", "A simulation batch cannot exceed 256 runs."))
            let runs =
                if crn.settings.simulator = Simulator.PDE then
                    Exploration.spatial crn |> Array.map (fun (instance, table, data) ->
                        let run = Conversion.simulation crn null instance table
                        SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, run.Series, run.Seed, run.Settings, null, data))
                elif crn.settings.simulator = Simulator.LNA || crn.settings.simulator = Simulator.CME then StatisticalSolvers.simulate crn
                else crn.simulate_case() |> List.map (fun result -> Conversion.simulation crn null result.instance result.table) |> List.toArray
            crn, runs, noInference
        | _ -> crn, [||], noInference

    let executeProgram (request: ModelRequest) =
        let original, program = CrnPrograms.parse request
        let update (simulation: Simulation_settings<Functional>) =
            { simulation with
                initial = if request.Initial.HasValue then request.Initial.Value else simulation.initial
                final = if request.Final.HasValue then request.Final.Value else simulation.final
                points = if request.Points.HasValue then request.Points.Value else simulation.points
                times = if request.Initial.HasValue || request.Final.HasValue || request.Points.HasValue then [] else simulation.times
                seed = if request.Seed.HasValue then Some request.Seed.Value else simulation.seed }
        let simulator =
            match request.Simulator with
            | "oslo" -> Simulator.Oslo | "ssa" -> Simulator.SSA | "lna" -> Simulator.LNA
            | "cme" -> Simulator.CME | "pde" -> Simulator.PDE | _ -> original.settings.simulator
        let crn = { original with settings = { original.settings with simulator = simulator; simulation = update original.settings.simulation; simulations = original.settings.simulations |> List.map update } }
        let active = if crn.settings.simulations.IsEmpty then [crn.settings.simulation] else crn.settings.simulations
        for sim in active do
            if not (Double.IsFinite sim.initial && Double.IsFinite sim.final) then raise (ExecutionFailure("INVALID_TIME", "The model's time bounds must be finite."))
            if request.Operation = "simulate" || request.Operation = "infer" then
                if sim.final <= sim.initial then raise (ExecutionFailure("INVALID_TIME_RANGE", "Final time must be greater than initial time."))
                if sim.points < 1 || sim.points > 100000 then raise (ExecutionFailure("INVALID_POINTS", "Output points must be between 1 and 100000."))
        if request.Operation = "simulate" && not (List.contains simulator [Simulator.Oslo; Simulator.SSA; Simulator.LNA; Simulator.CME; Simulator.PDE]) then
            raise (ExecutionFailure("UNSUPPORTED_SIMULATOR", "This build supports Oslo, SSA, LNA, CME and PDE."))
        let crn, runs, inference = run request crn
        let network = Conversion.network "initial" crn
        let result = ModelData("crn", "source", false, Conversion.settings crn, network.Species, network.Reactions, runs, inference, request.Code, program)
        EngineResponse(true, request.Operation, "current", result, [||])

type Engine private () =
    static member Info =
        EngineInfo("Visual DSD Rebooted", "0.9.0", [|"parse"; "expand"; "simulate"; "infer"; "analyze"|],
                   [|"auto"; "current"; "legacy"|], [|"source"; "default"; "detailed"; "finite"; "infinite"|], [|"source"; "oslo"; "ssa"; "lna"; "cme"; "pde"|], [|"dsd"; "crn"|])

    static member Execute(request: ModelRequest) : EngineResponse =
        let validation = RequestValidation.Validate request
        if validation.Length > 0 then EngineResponse(false, "", "", null, validation)
        else
            let dialect =
                if request.Language = "crn" then "current"
                elif request.Dialect = "auto" then
                    if request.Code.Contains("//old_syntax", StringComparison.Ordinal) then "legacy" else "current"
                else request.Dialect
            let failure code message = EngineResponse(false, request.Operation, dialect, null, [|Diagnostic(code, message)|])
            try
                Globalization.CultureInfo.CurrentCulture <- Globalization.CultureInfo.InvariantCulture
                Globalization.CultureInfo.CurrentUICulture <- Globalization.CultureInfo.InvariantCulture
                if request.Language = "crn" then CrnExecution.executeProgram request
                else
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
                            | "lna" -> Simulator.LNA
                            | "cme" -> Simulator.CME
                            | "pde" -> Simulator.PDE
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
                        elif (request.Operation = "simulate" || request.Operation = "infer") && (activeSimulations |> List.exists (fun sim -> sim.final <= sim.initial)) then
                            failure "INVALID_TIME_RANGE" "The model's final time must be finite and greater than its initial time."
                        elif (request.Operation = "simulate" || request.Operation = "infer") && (activeSimulations |> List.exists (fun sim -> sim.points < 1 || sim.points > 100000)) then
                            failure "INVALID_POINTS" "The model's output point count must be between 1 and 100000."
                        elif request.Operation = "simulate" && not (List.contains simulator [Simulator.Oslo; Simulator.SSA; Simulator.LNA; Simulator.CME; Simulator.PDE]) then
                            failure "UNSUPPORTED_SIMULATOR" "This build supports the managed Oslo, SSA, LNA, CME and spatial PDE simulators."
                        elif request.Operation = "analyze" && jit then
                            failure "JIT_ANALYSIS" "State exploration requires a fully expanded model."
                        elif request.Operation = "infer" && jit then
                            failure "JIT_INFERENCE" "Parameter inference requires a fully expanded model."
                        elif request.Operation = "simulate" && jit && simulator <> Simulator.SSA then
                            failure "JIT_SIMULATOR" "Just-in-time models require the stochastic simulator."
                        else
                            let update (settings: Crn_settings<'a>) =
                                { settings with simulator = simulator; simulation = updateSimulation settings.simulation
                                                simulations = settings.simulations |> List.map updateSimulation }
                            let configured =
                                match bundle with
                                | Dsd.ClassicDSD classic -> Dsd.ClassicDSD { classic with settings = update classic.settings }
                                | Dsd.Rules rules -> Dsd.Rules { rules with settings = update rules.settings }
                            let initialCrn = if request.Operation = "parse" || jit then Dsd.convert_unexpanded configured else Dsd.convert_expand configured
                            let crn, simulations, inference =
                                if jit && request.Operation = "simulate" then
                                    let instances = initialCrn.get_instances()
                                    if instances.Length > 256 then raise (ExecutionFailure("BATCH_TOO_LARGE", "A simulation batch cannot exceed 256 runs."))
                                    let run (instance: Instance<Functional>) =
                                        if instance.environment |> Map.exists (fun _ value -> not (Double.IsFinite value)) then
                                            raise (ExecutionFailure("INVALID_SWEEP", "Sweep parameter values must be finite."))
                                        // Reparse before expansion: parameters can also change domain rates and module arguments.
                                        // Each run owns its mutable species caches, reaction dictionaries and random generator.
                                        let fresh, _ = Dsd.parse_extended_with_parameters instance.environment toeholds specificities code
                                        let fresh = Dsd.set_options fresh (Options.setRules compilation (Dsd.get_options fresh))
                                        let runSettings (settings: Crn_settings<'a>) =
                                            let sim =
                                                if settings.simulations.IsEmpty then settings.simulation
                                                else settings.simulations |> List.find (fun sim -> sim.name = instance.settings.name)
                                            { settings with simulator = simulator; simulation = updateSimulation sim; simulations = []; sweeps = [] }
                                        let fresh =
                                            match fresh with
                                            | Dsd.ClassicDSD classic -> Dsd.ClassicDSD { classic with settings = runSettings classic.settings }
                                            | Dsd.Rules rules -> Dsd.Rules { rules with settings = runSettings rules.settings }
                                        let initial = Dsd.convert_unexpanded fresh
                                        let expanded, table =
                                            match Dsd.to_jit fresh with
                                            | Choice1Of2 state ->
                                                let finalState, table = Jit.simulate state (Dsd.makeDsdCalculus fresh)
                                                Jit.to_crn finalState initial, table
                                            | Choice2Of2 state ->
                                                let finalState, table = Jit.simulate state (Dsd.to_rules_calculus fresh)
                                                Jit.to_crn finalState initial, table
                                        expanded, Conversion.simulation expanded (Conversion.network "finalPopulation" expanded) instance table
                                    let results = instances |> List.map run
                                    if results.IsEmpty then raise (ExecutionFailure("EMPTY_BATCH", "The selected sweeps contain no simulation runs."))
                                    fst results.Head, results |> List.map snd |> List.toArray, Unchecked.defaultof<InferenceData>
                                else CrnExecution.run request initialCrn
                            if crn.initials.Length > 10000 || crn.reactions.Length > 50000 then
                                failure "MODEL_TOO_LARGE" "The expanded model exceeds the interactive result limit."
                            else
                                let network = Conversion.network (if jit && request.Operation = "simulate" then "finalPopulation" else "initial") crn
                                let model = ModelData((match configured with Dsd.ClassicDSD _ -> "classic" | Dsd.Rules _ -> "rules"),
                                                      compilation.ToString().ToLowerInvariant(), jit, Conversion.settings crn,
                                                      network.Species, network.Reactions, simulations, inference,
                                                      (if jit || request.Operation = "parse" then null else initialCrn.to_string()))
                                EngineResponse(true, request.Operation, dialect, model, [||])
            with
            | ExecutionFailure(code, message) -> failure code message
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
