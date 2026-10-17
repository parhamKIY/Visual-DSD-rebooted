namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal ParameterInference =
    let private fail code message = raise (ExecutionFailure(code, message))

    let private prepare (request: ModelRequest) (crn: Crn) =
        if not (List.contains crn.settings.simulator [Simulator.Oslo; Simulator.Sundials]) then fail "INFERENCE_SIMULATOR" "Parameter inference requires Oslo or Sundials."
        let options = crn.settings.inference
        let seed = if request.Seed.HasValue then uint32 request.Seed.Value else options.seeds |> List.tryHead |> Option.defaultValue options.seed
        if options.burnin < 0 || options.samples < 2 || options.thin < 1 || int64 options.burnin + int64 options.samples > 20000L || options.samples / options.thin < 2 || options.samples / options.thin > 500 then
            fail "INFERENCE_LIMIT" "Use nonnegative burnin, positive thinning, at most 20000 total iterations and 2–500 retained samples."
        match options.noise_parameter with
        | Noise_parameter.Fixed sigma when not (Double.IsFinite sigma) || sigma <= 0.0 -> fail "INFERENCE_NOISE" "Fixed observation noise must be finite and positive."
        | _ -> ()
        if not (Double.IsFinite crn.settings.deterministic.abstolerance && Double.IsFinite crn.settings.deterministic.reltolerance) || crn.settings.deterministic.abstolerance <= 0.0 || crn.settings.deterministic.reltolerance <= 0.0 then fail "INFERENCE_TOLERANCE" "Inference solver tolerances must be finite and positive."
        if crn.settings.parameters.Length > 256 then fail "INFERENCE_PARAMETERS" "A fitted system supports at most 256 total parameters."
        let variable = crn.settings.parameters |> List.filter Parameter.variable
        if variable.Length > 32 then fail "INFERENCE_PARAMETERS" "Declare at most 32 variable parameters using the original prior syntax."
        for p in crn.settings.parameters do
            if ["Iteration"; "logLikelihood"; "logPrior"; "sigma"] |> List.contains p.name || p.name.StartsWith("sigma_", StringComparison.Ordinal) then
                fail "INFERENCE_PARAMETERS" (sprintf "The parameter name %s is reserved by the inference engine." p.name)
            let parameter = Parameter.to_filzbach p
            if not (Double.IsFinite p.value && Double.IsFinite parameter.range.lb && Double.IsFinite parameter.range.ub) || parameter.range.lb > parameter.range.ub ||
               (Parameter.variable p && (parameter.range.lb = parameter.range.ub || p.value < parameter.range.lb || p.value > parameter.range.ub)) then
                fail "INFERENCE_PRIOR" (sprintf "Parameter %s has an invalid prior range or initial value." p.name)
            match p.prior with
            | Some prior when prior.interval = Interval.Log && Parameter.variable p && parameter.range.lb <= 0.0 -> fail "INFERENCE_PRIOR" (sprintf "Log parameter %s needs positive prior bounds." p.name)
            | _ -> ()
        let supplied = request.Data |> Array.map (fun dataset -> dataset.Name, dataset) |> Map.ofArray
        let declared = crn.settings.data |> List.map (fun dataset -> dataset.file)
        let names = if declared.IsEmpty then request.Data |> Array.map (fun dataset -> dataset.Name) |> Array.toList else declared
        if names.Length <> supplied.Count || names |> List.exists (fun name -> not (Map.containsKey name supplied)) then
            fail "INFERENCE_DATA" "Imported dataset names must match the model's directive data names exactly."
        let simulations = if crn.settings.simulations.IsEmpty then [crn.settings.simulation] else crn.settings.simulations
        let used = simulations |> List.collect (fun sim -> if sim.data.IsEmpty then names else sim.data) |> Set.ofList
        if used <> Set.ofList names then fail "INFERENCE_DATA" "Every imported dataset must be selected by a simulation."
        let align (simulation: Simulation_settings<Functional>) (table: ObservationData) : Table<float> =
            if not (isNull table.TimeUnit) && table.TimeUnit <> crn.settings.units.time.to_string then
                fail "INFERENCE_UNITS" "The CSV time unit must match the model's time unit."
            if not (Double.IsFinite simulation.initial && Double.IsFinite simulation.final) || simulation.final <= simulation.initial || simulation.points < 1 || simulation.points > 100000 then fail "INFERENCE_TIME" "Every fitted simulation requires finite increasing time bounds and 1–100000 output points."
            if table.Times |> Array.exists (fun time -> time < simulation.initial || time > simulation.final) then
                fail "INFERENCE_TIME" "Observation times must be within the selected simulation's initial and final times."
            let expected = simulation.plots |> List.map Functional2.to_string_plot
            if expected.IsEmpty || expected.Length <> table.Series.Length then
                fail "INFERENCE_COLUMNS" (sprintf "Data must have exactly the selected plot columns: %s" (String.concat ", " expected))
            let normalise (name:string) = if name.EndsWith("()", StringComparison.Ordinal) then name.Substring(0, name.Length - 2) else name
            let columns = simulation.plots |> List.map (fun plot ->
                let label = Functional2.to_string_plot plot
                let aliases =
                    match plot with
                    | Expression.Key (Key.Species species) ->
                        match Map.tryFind species.name crn.attributes with
                        | Some attributes -> [label; attributes.name; attributes.structure] |> List.map normalise
                        | None -> [label]
                    | _ -> [label]
                let matches = table.Series |> Array.filter (fun column -> List.contains (normalise column.Name) aliases)
                if matches.Length <> 1 then fail "INFERENCE_COLUMNS" (sprintf "Data must contain one unambiguous column for plot %s." label)
                matches.[0])
            if columns |> List.map (fun column -> column.Name) |> List.distinct |> List.length <> columns.Length then fail "INFERENCE_COLUMNS" "A data column cannot be assigned to more than one plot."
            { times = table.Times |> Array.toList; columns = List.zip expected columns |> List.map (fun (label,column) -> { name = label; values = column.Values |> Array.toList }) }
        // Tables belong to datasets, so shared datasets must use the same plot mapping in every selected simulation.
        let datasets = names |> List.map (fun name ->
            let selected = simulations |> List.filter (fun sim -> sim.data.IsEmpty || List.contains name sim.data)
            let tables = supplied.[name].Tables |> Array.toList
            let mapped = selected |> List.map (fun sim -> tables |> List.map (align sim))
            if mapped |> List.exists ((<>) mapped.Head) then fail "INFERENCE_COLUMNS" "A dataset selected by several simulations must use the same plots."
            Dataset.create name mapped.Head)
        let prepared = { crn with settings = { crn.settings with data = datasets; inference = { options with seed = seed; print_console = false; print_summary = false } } }
        prepared

    type Budget = { mutable iterations:int64; mutable measurements:int; mutable posteriorValues:int }
    let budget () = { iterations=0L; measurements=0; posteriorValues=0 }

    // Classical (unranked) split R-hat. Undefined for too few draws or zero within-chain variance.
    let splitRHat (chains:float[][]) =
        if chains.Length < 2 || chains |> Array.exists (fun chain -> chain.Length < 4) then Nullable()
        else
            let n = chains |> Array.map (fun c -> c.Length / 2) |> Array.min
            let halves = chains |> Array.collect (fun c -> [|c.[0..n-1]; c.[c.Length-n..]|])
            let means = halves |> Array.map Array.average
            let within = halves |> Array.map (fun c -> let mean = Array.average c in c |> Array.sumBy (fun v -> pown (v-mean) 2) |> fun sum -> sum / float(n-1)) |> Array.average
            let grand = Array.average means
            let between = float n * (means |> Array.sumBy (fun v -> pown (v-grand) 2)) / float(means.Length-1)
            let value = sqrt ((float(n-1)/float n * within + between/float n) / within)
            if within <= 0.0 || not (Double.IsFinite value) then Nullable() else Nullable value

    let runModel (request:ModelRequest) (model:Model) (work:Budget) =
        let options = model.top.settings.inference
        let seeds =
            if request.Seed.HasValue then
                if options.seeds.Length > 1 then fail "INFERENCE_CHAINS" "Remove the seed override to use the model's explicit list of chain seeds."
                [uint32 request.Seed.Value]
            elif options.seeds.IsEmpty then [options.seed] else options.seeds
        if seeds.Length > 4 || (List.distinct seeds).Length <> seeds.Length then fail "INFERENCE_CHAINS" "Use 1–4 distinct chain seeds."
        if options.lowerbound |> Option.exists (Double.IsFinite >> not) then fail "INFERENCE_CHAINS" "The chain likelihood lower bound must be finite."
        let active = model.top :: model.systems |> List.filter (fun crn -> (not crn.initials.IsEmpty || not crn.reactions.IsEmpty) && (not crn.settings.data.IsEmpty || model.systems.IsEmpty))
        if active.IsEmpty then fail "INFERENCE_DATA" "Declare observation datasets on at least one fitted system."
        let prepareOne (crn:Crn) =
            let names = crn.settings.data |> List.map (fun data -> data.file) |> Set.ofList
            let data = if names.IsEmpty then request.Data else request.Data |> Array.filter (fun data -> names.Contains data.Name)
            prepare (ModelRequest(Data=data,Seed=request.Seed)) { crn with settings = { crn.settings with simulator = model.top.settings.simulator; inference=options } }
        let preparedCrns : Crn list = active |> List.map prepareOne
        let preparedTop = preparedCrns |> List.tryFind (fun crn -> crn.name = model.top.name) |> Option.defaultValue { model.top with settings={model.top.settings with data=[]} }
        let prepared : Model = { top=preparedTop; systems=preparedCrns |> List.filter (fun crn -> crn.name <> model.top.name) }
        let globalSettings, odes = prepared.to_list_infer()
        let _, tables, inferenceParameters, replicatedOdes, _, _ = Ode.list_to_inference_method globalSettings odes
        let variable = inferenceParameters |> List.filter Parameter.variable
        let fixedNoise = match options.noise_parameter with Noise_parameter.Fixed _ -> true | _ -> false
        if variable.Length > 32 || (variable.IsEmpty && fixedNoise) then fail "INFERENCE_PARAMETERS" "The fitted problem requires at least one variable model or noise parameter and at most 32 variable model parameters."
        if tables.IsEmpty || tables.Length > 32 then fail "INFERENCE_DATA" "An inference problem must select 1–32 observation tables."
        let dataPoints = tables |> List.sumBy (fun table -> table.times.Length * table.columns.Length)
        work.measurements <- work.measurements + dataPoints
        work.iterations <- work.iterations + int64 seeds.Length * (int64 options.burnin + int64 options.samples)
        work.posteriorValues <- work.posteriorValues + seeds.Length * (options.samples / options.thin) * (variable.Length + 32)
        if work.measurements > 20000 || work.iterations > 20000L || work.posteriorValues > 200000 then fail "INFERENCE_LIMIT" "The complete inference request exceeds 20000 measurements, 20000 chain iterations or 200000 posterior values."
        let modelNames = inferenceParameters |> List.map (fun p -> p.name) |> Set.ofList
        let runs = seeds |> List.map (fun seed ->
            let settings = {globalSettings with inference={options with seed=seed; seeds=[]; lowerbound=None; print_console=false; print_summary=false}}
            let result = Ode.list_infer settings odes
            if result.mlesims.Length <> tables.Length || not (Double.IsFinite result.summary.mle) || result.summary.mle <= Double.MinValue/2.0 then fail "INFERENCE_FAILED" "A chain did not produce a finite fit for every observation table."
            if result.posterior.Length <> options.samples/options.thin then fail "INFERENCE_FAILED" "A chain returned an invalid posterior sample count."
            seed, result, options.lowerbound |> Option.forall (fun lower -> result.summary.mle > lower))
        let selected = runs |> List.filter (fun (_,_,included) -> included)
        if selected.IsEmpty then fail "INFERENCE_CHAINS" "No chain exceeded the requested likelihood lower bound."
        let bestSeed, best, _ = selected |> List.maxBy (fun (_,result,_) -> result.summary.mle)
        let posterior = selected |> List.collect (fun (_,result,_) -> result.posterior) |> List.toArray
        let convert (result:Inference.mcmc_result) = result.parameters |> List.map (fun p ->
            let samples = result.posterior |> List.map (fun sample -> sample.[p.name]) |> List.toArray
            if Array.append samples [|p.mle;p.mean;p.variance;p.median;p.l95;p.u95|] |> Array.exists (Double.IsFinite >> not) then fail "INFERENCE_FAILED" "A chain returned nonfinite parameter summaries."
            ParameterEstimateData(p.name, (if modelNames.Contains p.name then "model" else "noise"), p.mle,p.mean,p.variance,p.median,p.l95,p.u95,samples)) |> List.toArray
        let summaries = best.parameters |> List.map (fun p ->
            let samples = posterior |> Array.map (fun sample -> sample.[p.name])
            let stats = Microsoft.Research.Filzbach.FilzbachAnalysis.summary samples
            let q = Microsoft.Research.Filzbach.FilzbachAnalysis.qsummary samples
            let summary = {p with mean=stats.mean; variance=stats.variance; median=q.median; l95=q.lb95; u95=q.ub95; l68=q.lb68; u68=q.ub68}
            let rhat = selected |> List.map (fun (_,result,_) -> result.posterior |> List.map (fun draw -> draw.[p.name]) |> List.toArray) |> List.toArray |> splitRHat
            let numbers = Array.append samples [|p.mle;stats.mean;stats.variance;q.median;q.lb95;q.ub95|]
            if numbers |> Array.exists (Double.IsFinite >> not) then fail "INFERENCE_FAILED" "The inference engine returned nonfinite parameter estimates."
            summary, ParameterEstimateData(p.name,(if modelNames.Contains p.name then "model" else "noise"),p.mle,stats.mean,stats.variance,q.median,q.lb95,q.ub95,samples,rhat))
        let parameters = summaries |> List.map snd |> List.toArray
        let likelihood = posterior |> Array.map (fun sample -> sample.["logLikelihood"])
        let chains = runs |> List.map (fun (seed,result,included) ->
            let ll = result.posterior |> List.map (fun draw -> draw.["logLikelihood"]) |> List.toArray
            let estimates = convert result
            if ll |> Array.exists (Double.IsFinite >> not) || estimates |> Array.exists (fun p -> p.Samples |> Array.exists (Double.IsFinite >> not)) then fail "INFERENCE_FAILED" "A chain returned nonfinite posterior samples."
            let iterations = result.posterior |> List.map (fun draw -> int draw.["Iteration"]) |> List.toArray
            let prior = result.posterior |> List.map (fun draw -> draw.["logPrior"]) |> List.toArray
            if prior |> Array.exists (Double.IsFinite >> not) then fail "INFERENCE_FAILED" "A chain returned a nonfinite posterior log prior."
            InferenceChainData(int64 seed,included,result.summary.mle,estimates,ll,iterations,prior)) |> List.toArray
        let observations = List.map2 (fun (table:Table<float>) (ode:Ode) -> ObservationData(List.toArray table.times,table.columns |> List.map (fun c -> SeriesData(c.name,List.toArray c.values)) |> List.toArray,ode.settings.units.time.to_string)) tables replicatedOdes |> List.toArray
        let priors = inferenceParameters |> List.map (fun p -> ParameterPriorData(p.name,p.value,(p.prior |> Option.map (fun prior -> Distribution.to_string prior.distribution) |> Option.defaultValue "Fixed"),(p.prior |> Option.map (fun prior -> Interval.to_string prior.interval) |> Option.defaultValue "Fixed"),Parameter.variable p)) |> List.toArray
        let details = InferenceData(int64 bestSeed,options.burnin,options.samples,options.thin,posterior.Length,dataPoints,best.summary.mle,parameters,likelihood,observations,chains,(options.lowerbound |> Option.map Nullable |> Option.defaultValue (Nullable())),priors)
        let fitted = prepared.map_crns (fun crn -> crn.substitute best.mle)
        let results = List.map2 (fun (result:Result<float>) (ode:Ode) ->
            let source = preparedCrns |> List.find (fun crn -> crn.name = result.instance.model)
            let parameters = ode.settings.parameters |> Parameters.substitute best.mle |> Parameters.substitute result.instance.environment
            let missing = result.instance.environment |> Map.toList |> List.filter (fun (name,_) -> parameters |> List.forall (fun p -> p.name <> name)) |> List.map (fun (name,value) -> Parameter.create(name,value,None))
            {source with reactions=ode.reactions; initials=ode.initials; settings={ode.settings with parameters=parameters @ missing}},result) best.mlesims replicatedOdes
        let summary = best.to_summary()
        let summary = {summary with parameters = summaries |> List.fold (fun map (p,_) -> Map.add p.name p map) summary.parameters}
        fitted, results, details, summary

    let run (request:ModelRequest) (crn:Crn) =
        let declared = crn.settings.data |> List.map (fun d -> d.file) |> Set.ofList
        let imported = request.Data |> Array.map (fun d -> d.Name) |> Set.ofArray
        if not declared.IsEmpty && declared <> imported then fail "INFERENCE_DATA" "Imported dataset names must match the model's directive data names exactly."
        let fitted, results, details, _ = runModel request {top=crn; systems=[]} (budget())
        fitted.top, results |> List.map snd, details
