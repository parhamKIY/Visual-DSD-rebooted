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
        let mutable probabilityValues, probabilityStateCells = 0L, 0L
        instances |> List.map (fun instance ->
            let configured = Exploration.configure crn instance
            let scale = configured.settings.stochastic.scale
            if not (Double.IsFinite scale) || scale <= 0.0 then raise (ExecutionFailure("STATISTICAL_SCALE", "Stochastic scale must be finite and positive."))
            // Preserve the original CRN scaling convention: outputs are scaled copy populations.
            let current = configured.scale()
            if current.initials.Length > 256 then raise (ExecutionFailure("MODEL_TOO_LARGE", "Statistical solvers currently support at most 256 initial entries."))
            let env = Parameters.to_env current.settings.parameters
            let eval = Expression.eval (Environment.find env)
            if current.initials |> List.exists (fun initial -> initial.time |> Option.exists (fun time -> eval time <> current.settings.simulation.initial)) then
                raise (ExecutionFailure("STATISTICAL_EVENTS", "Timed population inputs are not supported by LNA and CME solvers."))
            if current.initials |> List.exists (fun initial -> let n = eval initial.value in not (Double.IsFinite n) || n < 0.0) then
                raise (ExecutionFailure("STATISTICAL_INITIALS", "Statistical solvers require finite nonnegative initial populations."))
            let initials = current.initials |> List.groupBy (fun initial -> initial.species) |> List.map (fun (_, entries) ->
                if entries |> List.exists (fun i -> i.spatial.IsSome) || (entries.Length > 1 && entries |> List.exists (fun i -> i.constant)) then
                    raise (ExecutionFailure("STATISTICAL_INITIALS", "Statistical solvers require nonspatial initials without conflicting constant declarations."))
                let amount = entries |> List.sumBy (fun initial -> eval initial.value)
                if not (Double.IsFinite amount) then raise (ExecutionFailure("STATISTICAL_INITIALS", "Aggregated populations must be finite."))
                { entries.Head with value = Expression.Float amount; time = None })
            let current = { current with initials = initials }
            let mutable probabilityData = Unchecked.defaultof<ProbabilityData>
            let table =
                if current.settings.simulator = Simulator.LNA then
                    if current.initials.Length > 128 then raise (ExecutionFailure("MODEL_TOO_LARGE", "LNA supports at most 128 distinct species because it integrates their full covariance matrix."))
                    if current.reactions |> Reaction.normalise_list |> List.exists (fun r -> match r.rate with Rate.Function _ -> true | _ -> false) then
                        raise (ExecutionFailure("LNA_RATES", "The original LNA solver supports mass-action reaction rates only."))
                    let variables = current.initials.Length * (current.initials.Length + 2)
                    if current.settings.deterministic.stiff && variables > 2048 then
                        raise (ExecutionFailure("LNA_LIMIT", "Stiff LNA is limited to 2048 covariance-system variables because its linear solver uses dense matrices."))
                    let sim = current.settings.simulation
                    if int64 (max (sim.points + 5) sim.times.Length) * int64 sim.plots.Length > 200000L then
                        raise (ExecutionFailure("LNA_LIMIT", "LNA output exceeds 200000 plot values per run. Reduce output points or plotted expressions."))
                    let lna = current.to_lna()
                    try
                        for plot in lna.ode.plots do Lna.affine_plot lna.initials current.settings.simulation.initial plot |> ignore
                    with error -> raise (ExecutionFailure("LNA_PLOTS", error.Message))
                    lna.simulate()
                else
                    let rates = Key.inline_rates_env env current.settings.rates
                    if current.reactions |> Reaction.normalise_list |> List.exists (fun r ->
                        match r.rate with
                        | Rate.Function e -> Expression.expand (Key.inline_keys env rates) e |> Expression.mentions |> List.contains Inlined.Time
                        | _ -> false) then
                        raise (ExecutionFailure("CME_RATE", "CME requires time-independent reaction propensities."))
                    if current.initials |> List.exists (fun initial -> initial.constant || let value = eval initial.value in not (Double.IsFinite value) || value < 0.0 || value > 1000000.0 || Math.Round value <> value) then
                        raise (ExecutionFailure("CME_INITIALS", "CME requires finite nonnegative integer populations and does not support constant species."))
                    // Resolve this run's parameters before enumerating states, including zero-rate transitions.
                    let inlineParameters key = match key with Key.Parameter name -> Expression.Float (Environment.find env name) | other -> Expression.Key other
                    let current = { current with reactions = current.reactions |> List.map (Reaction.map id (eval >> Expression.Float) (Expression.expand inlineParameters))
                                                 settings = { current.settings with rates = current.settings.rates |> Map.map (fun _ expression -> Expression.expand inlineParameters expression) }
                                             }
                    let calc, initial, reactions, adapter = current.initialise_ctmc()
                    let states =
                        try calc.to_ctmc_limited 4096 200000 (Hashtable.ofMap current.settings.rates) 1.0 initial reactions adapter
                        with error when error.Message.StartsWith("State space exceeds", StringComparison.Ordinal) -> raise (ExecutionFailure("STATE_SPACE_LIMIT", error.Message))
                    let size = states.ctmc.graph.Count
                    probabilityStateCells <- probabilityStateCells + int64 size * int64 current.initials.Length
                    if probabilityStateCells > int64 Distributions.maximumValues then
                        raise (ExecutionFailure("PROBABILITY_LIMIT", "Probability state vectors exceed 200000 population values per batch. Reduce sweeps or the state space."))
                    let sim = current.settings.simulation
                    let estimatedRows = if current.settings.simulator = Simulator.CMESundials && not sim.times.IsEmpty then sim.times.Length + 1 else max (sim.points + 5) sim.times.Length
                    if probabilityValues + int64 estimatedRows * int64 size > int64 Distributions.maximumValues then
                        raise (ExecutionFailure("PROBABILITY_LIMIT", "Probability output exceeds 200000 state values per batch. Reduce output points, sweeps or the state space."))
                    for state in states.ctmc.graph |> Dictionary.keys do
                        for edge in Dictionary.find states.ctmc.graph state do
                            let rate = Expression.eval (Environment.find env) edge.propensity
                            if not (Double.IsFinite rate) || rate < 0.0 then raise (ExecutionFailure("CME_RATE", "CME propensities must be finite and nonnegative."))
                    if size > 2048 && current.settings.deterministic.stiff then
                        raise (ExecutionFailure("STATE_SPACE_LIMIT", "Stiff CME supports at most 2048 states because its linear solver uses dense matrices."))
                    // Raw solvers integrate species moments; arbitrary plot moments are evaluated from the joint distribution.
                    let solver = { current with settings = { current.settings with simulation = { sim with plots = current.initials |> List.map (fun i -> Expression.Key (Key.Species i.species)) } } }
                    let cme = solver.to_cme states
                    let solved, table =
                        if current.settings.simulator = Simulator.CMESundials then cme.simulate_sundials env (Crn.to_inlined_rates current.settings)
                        else Cme.simulate env (Crn.to_inlined_rates current.settings) false cme
                    let data, table = Distributions.prepare current table.times solved.probabilities
                    probabilityData <- data
                    probabilityValues <- probabilityValues + int64 table.times.Length * int64 size
                    table
            let run = Conversion.statistical current instance table
            SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, run.Series, run.Seed, run.Settings, null, null, null, probabilityData)) |> List.toArray

    let moments (crn: Crn) =
        crn.get_instances() |> List.map (fun instance ->
            let current = { crn with settings = { crn.settings with simulation = instance.settings } } |> fun model -> model.substitute instance.environment
            let env = Parameters.to_env current.settings.parameters
            let eval = Expression.eval (Environment.find env)
            let mc = current.settings.moment_closure
            if not (Double.IsFinite mc.initial_minimum) || mc.initial_minimum <= 0.0 then
                raise (ExecutionFailure("MC_INITIAL_MINIMUM", "Moment closure initial_minimum must be finite and positive."))
            if current.settings.stochastic.scale <> 1.0 then raise (ExecutionFailure("STATISTICAL_SCALE", "Moment closure requires stochastic scale=1."))
            if current.initials |> List.exists (fun initial -> initial.constant) then
                raise (ExecutionFailure("MC_CONSTANTS", "Moment closure does not support constant species."))
            if current.initials |> List.exists (fun initial -> let value = eval initial.value in not (Double.IsFinite value) || value < 0.0) then
                raise (ExecutionFailure("MC_INITIALS", "Moment closure requires finite nonnegative initial populations."))
            if current.initials |> List.exists (fun initial -> initial.time |> Option.exists (fun time -> eval time <> current.settings.simulation.initial)) then
                raise (ExecutionFailure("STATISTICAL_EVENTS", "Moment closure does not support timed population inputs."))
            if current.reactions |> List.exists (fun reaction -> match reaction.rate, reaction.reverse with Rate.Function _, _ | _, Some (Rate.Function _) -> true | _ -> false) then
                raise (ExecutionFailure("MC_RATES", "Moment closure supports mass-action reactions only."))
            let closure = current |> Moments.generateMoments |> Moments.generateClosure
            let _, table = Moments.simulate closure
            let run = Conversion.statistical current instance table
            // Upstream fills uncomputed uncertainties with zero. Expose those as absent.
            let series =
                Array.map2 (fun (series: SeriesData) (_, secondMoment) ->
                    if Option.isSome secondMoment then series else SeriesData(series.Name, series.Values))
                    run.Series (closure.mc_settings.plots |> List.toArray)
            SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, series, run.Seed, run.Settings, null)) |> List.toArray

module private CrnExecution =
    let ordinary (crn:Crn) =
        if not EngineTelemetry.Active || not (List.contains crn.settings.simulator [Simulator.Oslo;Simulator.SSA]) then crn.simulate_case() else
        crn.get_instances() |> List.map(fun instance ->
            let current=Exploration.configure crn instance
            let observe=LiveProgress.run current instance
            let table =
                if crn.settings.simulator=Simulator.Oslo then
                    let ode=current.to_oslo()
                    let rows=ref []
                    let output row=observe row; rows.Value<-row::rows.Value
                    ode.simulate_callback (ref false) output ignore |> ignore
                    ode.process_simulation rows.Value
                elif crn.settings.simulator=Simulator.SSA then
                    let ssa=current.to_ssa()
                    if ssa.settings.trajectories=1 && ssa.simulator.settings.times.IsEmpty then
                        let rows=ref []
                        let output row=observe row;rows.Value<-row::rows.Value
                        ssa.simulate_callback (ref false) output ignore None |> ignore
                        Table.from_rows_reverse (ssa.simulator.settings.plots |> List.map Functional2.to_string_plot) rows.Value
                    else ssa.simulate()
                else current.simulate_case() |> List.exactlyOne |> fun result -> result.table
            Result<float>.create instance table)

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
            if List.contains crn.settings.simulator [Simulator.Sundials; Simulator.CMESundials; Simulator.MC; Simulator.LNA; Simulator.CME; Simulator.PDE] then
                let ode = crn.settings.deterministic
                if not (Double.IsFinite ode.abstolerance && Double.IsFinite ode.reltolerance) || ode.abstolerance <= 0.0 || ode.reltolerance <= 0.0 then
                    raise (ExecutionFailure("INVALID_TOLERANCE", "Solver tolerances must be finite and positive."))
                for instance in crn.get_instances() do
                    let sim = instance.settings
                    if sim.times |> List.exists (fun t -> not (Double.IsFinite t) || t < sim.initial || t > sim.final) then
                        raise (ExecutionFailure("INVALID_OUTPUT_TIMES", "Output times must be finite and within the simulation interval."))
                    if sim.times |> List.pairwise |> List.exists (fun (a,b) -> b < a) then
                        raise (ExecutionFailure("INVALID_OUTPUT_TIMES", "Output times must be nondecreasing."))
            let runs =
                if crn.settings.simulator = Simulator.PDE then
                    Exploration.spatial crn |> Array.map (fun (instance, table, data) ->
                        let run = Conversion.simulation crn null instance table
                        SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, run.Series, run.Seed, run.Settings, null, data))
                elif crn.settings.simulator = Simulator.LNA || crn.settings.simulator = Simulator.CME || crn.settings.simulator = Simulator.CMESundials then StatisticalSolvers.simulate crn
                elif crn.settings.simulator = Simulator.MC then StatisticalSolvers.moments crn
                else ordinary crn |> List.map (fun result -> Conversion.simulation crn null result.instance result.table) |> List.toArray
            crn, runs, noInference
        | _ -> crn, [||], noInference

    let executeProgram (request: ModelRequest) =
        LiveProgress.phase "expanding" "Preparing the CRN program."
        let original, program, graph = CrnPrograms.parse request
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
            | "cme" -> Simulator.CME | "pde" -> Simulator.PDE
            | "sundials" -> Simulator.Sundials | "cmesundials" -> Simulator.CMESundials | "mc" -> Simulator.MC | _ -> original.settings.simulator
        let crn = { original with settings = { original.settings with simulator = simulator; simulation = update original.settings.simulation; simulations = original.settings.simulations |> List.map update } }
        let crn = crn.saturate_plots()
        let active = if crn.settings.simulations.IsEmpty then [crn.settings.simulation] else crn.settings.simulations
        for sim in active do
            if not (Double.IsFinite sim.initial && Double.IsFinite sim.final) then raise (ExecutionFailure("INVALID_TIME", "The model's time bounds must be finite."))
            if request.Operation = "simulate" || request.Operation = "infer" then
                if sim.final <= sim.initial then raise (ExecutionFailure("INVALID_TIME_RANGE", "Final time must be greater than initial time."))
                if sim.points < 1 || sim.points > 100000 then raise (ExecutionFailure("INVALID_POINTS", "Output points must be between 1 and 100000."))
        if request.Operation = "simulate" && not (List.contains simulator [Simulator.Oslo; Simulator.SSA; Simulator.LNA; Simulator.CME; Simulator.PDE; Simulator.Sundials; Simulator.CMESundials; Simulator.MC]) then
            raise (ExecutionFailure("UNSUPPORTED_SIMULATOR", "This build supports Oslo, SSA, LNA, CME, PDE, Sundials, CMESundials and Moment Closure."))
        if request.Operation = "infer" then
            if graph.nodes.Count > 8 then raise (ExecutionFailure("INFERENCE_LIMIT", "Inference supports at most eight model nodes per request."))
            let expanded = Microsoft.Research.CRNEngine.InferenceSiteGraph.expandAndLift graph
            let expanded = expanded |> Microsoft.Research.CRNEngine.InferenceSiteGraph.mapNodes (fun _ model ->
                model.merge_shared_settings().map_crns (fun item ->
                    let simulator = match request.Simulator with "source" -> model.top.settings.simulator | _ -> simulator
                    {item with settings={item.settings with simulator=simulator; simulation=update item.settings.simulation; simulations=item.settings.simulations |> List.map update}} |> fun crn -> crn.saturate_initials().saturate_plots()))
            let declared = expanded.nodes |> Map.toList |> List.collect (fun (_,model) -> model.top::model.systems |> List.filter (fun crn -> not crn.initials.IsEmpty || not crn.reactions.IsEmpty) |> List.collect (fun crn -> crn.settings.data |> List.map (fun data -> data.file))) |> Set.ofList
            let imported = request.Data |> Array.map (fun data -> data.Name) |> Set.ofArray
            if not declared.IsEmpty && declared <> imported then raise (ExecutionFailure("INFERENCE_DATA", "Imported datasets must match the datasets used by the complete fitted program."))
            if expanded.nodes.Count > 1 && declared.IsEmpty then raise (ExecutionFailure("INFERENCE_DATA", "Linked model nodes require explicit dataset declarations."))
            if expanded.nodes.Count > 1 && expanded.nodes |> Map.exists (fun _ model -> model.systems.IsEmpty && model.top.settings.data.IsEmpty) then
                raise (ExecutionFailure("INFERENCE_DATA", "Every standalone linked node must declare its own observation datasets."))
            let assignments = expanded.edges |> Map.toList |> List.collect (fun (_,targets) -> targets |> List.collect (fun (target,props) -> props |> List.map (fun (_,parameter,_) -> target.to_string,parameter)))
            if List.distinct assignments |> List.length <> assignments.Length then raise (ExecutionFailure("INFERENCE_LINK", "A linked parameter cannot receive more than one incoming prior."))
            let work = ParameterInference.budget()
            let nodes = ResizeArray<InferenceNodeData>()
            let mutable pending = expanded
            while not pending.nodes.IsEmpty do
                for id in Microsoft.Research.CRNEngine.InferenceSiteGraph.getNextCandidates pending do
                    let fitted, results, details, summary = ParameterInference.runModel request pending.nodes.[id] work
                    let runs = results |> List.map (fun (source,result) ->
                        let network = Conversion.network "initial" source
                        let instance = if fitted.systems.IsEmpty then result.instance else {result.instance with name=source.name + (if result.instance.name = "" then "" else " · " + result.instance.name)}
                        Conversion.simulation source network instance result.table) |> List.toArray
                    let selected = if id = program.SelectedNodeId && program.SelectedSystemId <> "" then fitted.systems |> List.tryFind (fun crn -> crn.name = program.SelectedSystemId) |> Option.defaultValue crn
                                   elif not fitted.top.initials.IsEmpty || not fitted.top.reactions.IsEmpty then fitted.top
                                   else fitted.systems.Head
                    nodes.Add(InferenceNodeData(id,Conversion.settings selected,Conversion.network "initial" selected,runs,details))
                    try pending <- Microsoft.Research.CRNEngine.InferenceSiteGraph.updateGraph pending (id,summary)
                    with error -> raise (ExecutionFailure("INFERENCE_LINK", error.Message))
            let selected = nodes |> Seq.find (fun node -> node.NodeId = program.SelectedNodeId)
            let result = ModelData("crn","source",false,selected.Settings,selected.Network.Species,selected.Network.Reactions,selected.Simulations,selected.Inference,request.Code,program,(if nodes.Count > 1 then nodes.ToArray() else null))
            EngineResponse(true,request.Operation,"current",result,[||])
        else
            let crn, runs, inference = run request crn
            let network = Conversion.network "initial" crn
            let result = ModelData("crn", "source", false, Conversion.settings crn, network.Species, network.Reactions, runs, inference, request.Code, program, null, (if request.Operation = "synthesize" then Synthesis.run request crn else null),
                                                      (if request.Operation = "export" then Exports.run crn else null))
            EngineResponse(true, request.Operation, "current", result, [||])

type Engine private () =
    static member SequenceDatabases = DsdWorkspace.defaults
    static member Info =
        EngineInfo("Visual DSD Rebooted", "0.17.0", [|"parse"; "expand"; "simulate"; "infer"; "analyze"; "synthesize"; "export"|],
                   [|"auto"; "current"; "legacy"|], [|"source"; "default"; "detailed"; "finite"; "infinite"|], [|"source"; "oslo"; "ssa"; "lna"; "cme"; "pde"; "sundials"; "cmesundials"; "mc"|], [|"dsd"; "crn"|])

    static member Execute(request: ModelRequest) : EngineResponse =
        LiveProgress.phase "preparing" "Preparing and validating the model."
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
                    LiveProgress.phase "expanding" "Parsing DSD and preparing the reaction network."
                    let original, _ = Dsd.parse_extended_with_options (DsdWorkspace.configure request) Environment.empty toeholds specificities code
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
                            | "sundials" -> Simulator.Sundials
                            | "cmesundials" -> Simulator.CMESundials
                            | "mc" -> Simulator.MC
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
                        elif request.Operation = "simulate" && not (List.contains simulator [Simulator.Oslo; Simulator.SSA; Simulator.LNA; Simulator.CME; Simulator.PDE; Simulator.Sundials; Simulator.CMESundials; Simulator.MC]) then
                            failure "UNSUPPORTED_SIMULATOR" "This build supports Oslo, SSA, LNA, CME, PDE, Sundials, CMESundials and Moment Closure."
                        elif request.Operation = "export" && jit then
                            failure "JIT_EXPORT" "Scientific export requires a fully expanded model. Save the JIT simulation network and data separately."
                        elif request.Operation = "synthesize" && jit then
                            failure "JIT_SYNTHESIS" "Parameter synthesis requires a fully expanded model."
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
                                if jit && (request.Operation = "simulate" || request.Operation = "analyze") then
                                    let mutable stateCount, edgeCount = 0, 0
                                    let instances = initialCrn.get_instances()
                                    if instances.Length > 256 then raise (ExecutionFailure("BATCH_TOO_LARGE", "A simulation batch cannot exceed 256 runs."))
                                    let run (instance: Instance<Functional>) =
                                        if instance.environment |> Map.exists (fun _ value -> not (Double.IsFinite value)) then
                                            raise (ExecutionFailure("INVALID_SWEEP", "Sweep parameter values must be finite."))
                                        // Reparse before expansion: parameters can also change domain rates and module arguments.
                                        // Each run owns its mutable species caches, reaction dictionaries and random generator.
                                        let fresh, _ = Dsd.parse_extended_with_options (DsdWorkspace.configure request) instance.environment toeholds specificities code
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
                                        if request.Operation = "analyze" then
                                            let expanded, graph =
                                                match Dsd.to_jit fresh with
                                                | Choice1Of2 state -> JitExploration.run initial state (Dsd.makeDsdCalculus fresh)
                                                | Choice2Of2 state -> JitExploration.run initial state (Dsd.to_rules_calculus fresh)
                                            stateCount <- stateCount + graph.States.Length
                                            edgeCount <- edgeCount + graph.Transitions.Length
                                            if stateCount > 5000 || edgeCount > 20000 then raise (ExecutionFailure("STATE_SPACE_LIMIT", "JIT state exploration exceeds 5000 states or 20000 transitions per batch."))
                                            let network = Conversion.network "initial" expanded
                                            let run = Conversion.simulation expanded network instance { Table.times = []; columns = [] }
                                            expanded, SimulationData(run.Name, run.Sweep, run.Assignment, run.Times, run.Series, run.Seed, run.Settings, network, null, graph)
                                        else
                                            let expanded, table =
                                                match Dsd.to_jit fresh with
                                                | Choice1Of2 state ->
                                                    let finalState, table = Jit.simulate_observed (LiveProgress.run initial instance) state (Dsd.makeDsdCalculus fresh)
                                                    Jit.to_crn finalState initial, table
                                                | Choice2Of2 state ->
                                                    let finalState, table = Jit.simulate_observed (LiveProgress.run initial instance) state (Dsd.to_rules_calculus fresh)
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
                                                      (if jit || request.Operation = "parse" then null else initialCrn.to_string()), null, null,
                                                      (if request.Operation = "synthesize" then Synthesis.run request crn else null),
                                                      (if request.Operation = "export" then Exports.run crn else null), DsdWorkspace.describe configured)
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
