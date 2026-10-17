namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal ParameterInference =
    let private fail code message = raise (ExecutionFailure(code, message))

    let run (request: ModelRequest) (crn: Crn) =
        if crn.settings.simulator <> Simulator.Oslo then fail "INFERENCE_SIMULATOR" "Parameter inference requires the deterministic Oslo simulator."
        let options = crn.settings.inference
        let seed = if request.Seed.HasValue then uint32 request.Seed.Value else options.seeds |> List.tryHead |> Option.defaultValue options.seed
        if options.seeds.Length > 1 || options.lowerbound.IsSome then fail "INFERENCE_CHAINS" "Run each inference chain separately; combined-chain filtering is not available in this workspace."
        if options.burnin < 0 || options.samples < 2 || options.thin < 1 || int64 options.burnin + int64 options.samples > 20000L || options.samples / options.thin < 2 || options.samples / options.thin > 500 then
            fail "INFERENCE_LIMIT" "Use nonnegative burnin, positive thinning, at most 20000 total iterations and 2–500 retained samples."
        match options.noise_parameter with
        | Noise_parameter.Fixed sigma when not (Double.IsFinite sigma) || sigma <= 0.0 -> fail "INFERENCE_NOISE" "Fixed observation noise must be finite and positive."
        | _ -> ()
        let variable = crn.settings.parameters |> List.filter Parameter.variable
        if variable.IsEmpty || variable.Length > 32 then fail "INFERENCE_PARAMETERS" "Declare 1–32 variable parameters using the original prior syntax."
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
        let _, tables, inferenceParameters, _, _, _ = Ode.list_to_inference_method prepared.settings [prepared.to_ode()]
        if tables.IsEmpty || tables.Length > 32 then fail "INFERENCE_DATA" "An inference problem must select 1–32 observation tables."
        if tables |> List.sumBy (fun table -> table.times.Length * table.columns.Length) > 20000 then fail "INFERENCE_DATA" "Selected observation tables exceed 20000 measurements."
        if inferenceParameters |> List.filter Parameter.variable |> List.length > 32 then fail "INFERENCE_PARAMETERS" "Expanded inference problems support at most 32 variable model parameters."
        let modelParameterNames = inferenceParameters |> List.map (fun parameter -> parameter.name) |> Set.ofList
        let result = prepared.infer()
        if result.mlesims.Length <> tables.Length || not (Double.IsFinite result.summary.mle) || result.summary.mle <= Double.MinValue / 2.0 then
            fail "INFERENCE_FAILED" "The inference engine did not produce a finite fit for all observation tables."
        let posterior = result.posterior |> List.toArray
        if posterior.Length < 2 || posterior.Length > 500 then fail "INFERENCE_FAILED" "The inference engine returned an invalid posterior sample count."
        let parameters = result.parameters |> List.map (fun p ->
            let samples = posterior |> Array.map (fun sample -> sample.[p.name])
            let numbers = Array.append samples [|p.mle; p.mean; p.variance; p.median; p.l95; p.u95|]
            if numbers |> Array.exists (Double.IsFinite >> not) then fail "INFERENCE_FAILED" "The inference engine returned nonfinite parameter estimates."
            ParameterEstimateData(p.name, (if modelParameterNames.Contains p.name then "model" else "noise"),
                                  p.mle, p.mean, p.variance, p.median, p.l95, p.u95, samples)) |> List.toArray
        let observations = tables |> List.map (fun table -> ObservationData(table.times |> List.toArray, table.columns |> List.map (fun column -> SeriesData(column.name, column.values |> List.toArray)) |> List.toArray, crn.settings.units.time.to_string)) |> List.toArray
        let likelihood = posterior |> Array.map (fun sample -> sample.["logLikelihood"])
        if likelihood |> Array.exists (Double.IsFinite >> not) then fail "INFERENCE_FAILED" "The posterior contains a nonfinite likelihood."
        let details = InferenceData(int64 seed, options.burnin, options.samples, options.thin, posterior.Length, result.summary.numData, result.summary.mle, parameters, likelihood, observations)
        prepared.substitute result.mle, result.mlesims, details
