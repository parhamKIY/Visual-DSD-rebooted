namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal LogicCases =
    let parameterEnvironment (request: ModelRequest) =
        if isNull request.LogicCase || isNull request.LogicCase.Parameters then Map.empty
        else request.LogicCase.Parameters |> Array.map (fun p -> p.Name, p.Value) |> Map.ofArray

    let overrideParameters (request: ModelRequest) (crn: Crn) =
        let values = parameterEnvironment request
        for KeyValue(name,_) in values do
            if not (crn.settings.parameters |> List.exists (fun p -> p.name = name)) then
                raise (ExecutionFailure("LOGIC_PARAMETERS", "Unknown declared parameter: " + name))
        let parameters = crn.settings.parameters |> List.map (fun p ->
            match Map.tryFind p.name values with
            | Some value -> { p with value = value }
            | None -> p)
        { crn with settings = { crn.settings with parameters = parameters } }

    let configure (request: ModelRequest) (crn: Crn) =
        if isNull request.LogicCase then crn else
        let crn = overrideParameters request crn
        let fail message = raise (ExecutionFailure("LOGIC_MAPPING", message))
        if not crn.settings.sweeps.IsEmpty || not crn.settings.simulations.IsEmpty then
            fail "Logic cases require one simulation without source sweeps or named batches."
        if crn.settings.simulator = Simulator.SSA then
            if crn.settings.stochastic.steps.IsSome || crn.settings.stochastic.trajectories <> 1 || not crn.settings.simulation.times.IsEmpty then
                fail "SSA logic cases require one trajectory, no reaction-step limit and no explicit source output times. Repeats are managed by the comparison plan."
            if not (Double.IsFinite crn.settings.stochastic.scale) || crn.settings.stochastic.scale <= 0.0 then
                fail "SSA logic cases require finite positive stochastic scaling."
        if crn.initials |> List.exists (fun i -> i.time.IsSome || i.spatial.IsSome) then
            fail "Logic cases require homogeneous initial populations without scheduled inputs."
        let identity (species: Species) =
            Map.tryFind species.name crn.attributes |> Option.map (fun a -> a.structure) |> Option.defaultValue species.name
        let resolve key =
            let candidates = crn.initials |> List.map (fun i -> i.species) |> List.distinct |> List.filter (fun s -> identity s = key)
            match candidates with
            | [species] -> species
            | _ -> fail ("Molecular structure is missing or ambiguous: " + key)
        let inputs = request.LogicCase.Inputs |> Array.map (fun i -> resolve i.Structure, i.Value) |> Map.ofArray
        let seen = Collections.Generic.HashSet<Species>()
        // Multiple source contributions become one total concentration, not an override per contribution.
        let initials = crn.initials |> List.map (fun i ->
            match Map.tryFind i.species inputs with
            | Some value ->
                if i.constant then fail "A logical input cannot be a constant population."
                { i with value = Expression.Float (if seen.Add i.species then value else 0.0) }
            | None -> i)
        let plots = request.LogicCase.Outputs |> Array.map (resolve >> Key.Species >> Expression.Key) |> Array.toList
        { crn with initials = initials; settings = { crn.settings with simulation = { crn.settings.simulation with plots = plots } } }
