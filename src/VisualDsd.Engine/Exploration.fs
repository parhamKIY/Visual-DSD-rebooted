namespace VisualDsd.Engine

open System
open System.Collections.Generic
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module Exploration =
    let fail code message = raise (ExecutionFailure(code, message))
    let instances (crn: Crn) =
        let runs = crn.get_instances()
        if runs.IsEmpty || runs.Length > 256 then fail "BATCH_TOO_LARGE" "A batch requires between 1 and 256 runs."
        runs
    let configure (crn: Crn) (instance: Instance<Functional>) =
        if instance.environment |> Map.exists (fun _ value -> not (Double.IsFinite value)) then fail "INVALID_SWEEP" "Sweep values must be finite."
        { crn with settings = { crn.settings with simulation = instance.settings } } |> fun model -> model.substitute instance.environment
    let checkInitials prefix (crn: Crn) =
        let env = Parameters.to_env crn.settings.parameters
        let eval = Expression.eval (Environment.find env)
        if crn.initials |> List.exists (fun initial -> initial.constant || initial.time |> Option.exists (fun time -> eval time <> crn.settings.simulation.initial)) then
            fail (prefix + "_INITIALS") "This operation does not support constant species or timed population inputs."
        if crn.initials |> List.exists (fun initial -> let value = eval initial.value in not (Double.IsFinite value) || value < 0.0) then
            fail (prefix + "_INITIALS") "Initial populations must be finite and nonnegative."
        env, eval

    let analyze (crn: Crn) =
        let mutable transitionCount = 0
        let mutable stateCount = 0
        instances crn |> List.map (fun instance ->
            let current = configure crn instance
            let env, eval = checkInitials "STATE_SPACE" current
            if current.settings.stochastic.scale <> 1.0 || current.initials |> List.exists (fun initial -> initial.spatial.IsSome) then
                fail "STATE_SPACE_SETTINGS" "State exploration requires stochastic scale=1 and nonspatial initial populations."
            let species = current.initials |> List.map (fun initial -> initial.species) |> List.distinct |> List.toArray
            if species.Length > 128 then fail "STATE_SPACE_LIMIT" "State exploration supports at most 128 species."
            let index = species |> Array.mapi (fun i sp -> sp, i) |> Map.ofArray
            let counts = Array.zeroCreate<int> species.Length
            for initial in current.initials do
                let amount = eval initial.value
                if Math.Round amount <> amount || amount > 1000000.0 then fail "STATE_SPACE_INITIALS" "State exploration requires integer populations no larger than 1000000."
                let i = index.[initial.species]
                counts.[i] <- counts.[i] + int amount
                if counts.[i] > 1000000 then fail "STATE_SPACE_INITIALS" "An aggregated initial population exceeds 1000000."
            let inlineKey key = match key with Key.Parameter name -> Expression.Float (Environment.find env name) | other -> Expression.Key other
            if current.reactions |> List.exists (fun reaction ->
                let timeDependent = function Rate.Function expression -> Expression.mentions expression |> List.contains Key.Time | _ -> false
                timeDependent reaction.rate || reaction.reverse |> Option.exists timeDependent) || current.settings.rates |> Map.exists (fun _ expression -> Expression.mentions expression |> List.contains Key.Time) then
                fail "STATE_SPACE_RATE" "State exploration requires time-independent rates."
            let reactions = current.reactions |> Reaction.normalise_list |> List.map (fun reaction -> if current.settings.simulation.kinetics = Kinetics.Deterministic then { reaction with rate = reaction.rate.map reaction.stochastic_to_deterministic id } else reaction) |> List.map (Reaction.map (fun sp -> index.[sp]) (eval >> Expression.Float) (Expression.expand inlineKey >> Expression.map (Key.map (fun sp -> index.[sp]))))
            let rates = current.settings.rates |> Map.map (fun _ value -> value |> Expression.expand inlineKey |> Expression.map (Key.map (fun sp -> index.[sp]))) |> Hashtable.ofMap
            let states = ResizeArray<State>()
            let indices = Dictionary<State,int>()
            let transitions = ResizeArray<StateTransitionData>()
            let initial = counts |> Array.mapi (fun i n -> i,n) |> Array.filter (snd >> ((<) 0)) |> Map.ofArray
            states.Add initial; indices.Add(initial, 0)
            let mutable cursor = 0
            while cursor < states.Count do
                let state = states.[cursor]
                let population i = Map.tryFind i state |> Option.defaultValue 0
                let targets = Dictionary<State,float>()
                for reaction in reactions do
                    if reaction.reactants |> List.forall (fun entry -> population entry.element >= entry.multiplicity) then
                        let propensity = Ctmc.calculate_reaction_prop 1.0 state reaction rates |> eval
                        if not (Double.IsFinite propensity) || propensity < 0.0 then fail "STATE_SPACE_RATE" "Transition propensities must be finite and nonnegative. Time-dependent rates are not supported."
                        if propensity > 0.0 then
                            let values = Array.init species.Length population
                            for entry in reaction.reactants do values.[entry.element] <- values.[entry.element] - entry.multiplicity
                            for entry in reaction.products do
                                let amount = int64 values.[entry.element] + int64 entry.multiplicity
                                if amount > 1000000L then fail "STATE_SPACE_LIMIT" "A reachable population exceeds 1000000."
                                values.[entry.element] <- int amount
                            let target = values |> Array.mapi (fun i n -> i,n) |> Array.filter (snd >> ((<) 0)) |> Map.ofArray
                            // Self reactions do not change CTMC state and are not graph edges.
                            if target <> state then
                                let old = match targets.TryGetValue target with true, value -> value | _ -> 0.0
                                let rate = old + propensity
                                if not (Double.IsFinite rate) then fail "STATE_SPACE_RATE" "Aggregated transition rate is nonfinite."
                                targets.[target] <- rate
                for KeyValue(target, rate) in targets do
                    let targetIndex =
                        match indices.TryGetValue target with
                        | true, i -> i
                        | _ ->
                            if states.Count >= 1000 || stateCount + states.Count >= 5000 then fail "STATE_SPACE_LIMIT" "State exploration exceeds the limit of 1000 states per run or 5000 per batch."
                            let i = states.Count
                            states.Add target; indices.Add(target, i); i
                    transitionCount <- transitionCount + 1
                    if transitionCount > 20000 then fail "STATE_SPACE_LIMIT" "State exploration exceeds 20000 transitions per batch."
                    transitions.Add(StateTransitionData(cursor, targetIndex, rate))
                cursor <- cursor + 1
            stateCount <- stateCount + states.Count
            let populations = states |> Seq.map (fun state -> Array.init species.Length (fun i -> Map.tryFind i state |> Option.defaultValue 0)) |> Seq.toArray
            instance, StateSpaceData(species |> Array.map (fun sp -> sp.name), 0, populations, transitions.ToArray())) |> List.toArray

    let spatial (crn: Crn) =
        let mutable samples = 0L
        instances crn |> List.map (fun instance ->
            let current = configure crn instance
            let _, eval = checkInitials "SPATIAL" current
            if current.initials |> List.exists (fun initial -> initial.spatial |> Option.exists (fun spatial -> not (Double.IsFinite spatial.random) || spatial.random < 0.0 || spatial.random > 2.0)) then fail "SPATIAL_INITIALS" "Spatial initial random perturbations must be between 0 and 2."
            let settings = current.settings.spatial
            let simulation = current.settings.simulation
            if settings.dimensions <> 1 && settings.dimensions <> 2 then fail "SPATIAL_SETTINGS" "Spatial dimensions must be 1 or 2."
            let maximumNx = if settings.dimensions = 1 then 128 else 64
            if settings.nx < 4 || settings.nx > maximumNx || not (Double.IsFinite settings.xmax) || settings.xmax <= 0.0 || not (Double.IsFinite settings.dt) || settings.dt < 0.0 || not (Double.IsFinite settings.random) || settings.random < 0.0 || settings.random > 2.0 then
                fail "SPATIAL_SETTINGS" "Use nx=4..128 in 1D or 4..64 in 2D, positive xmax, nonnegative dt, and random=0..2."
            if simulation.points > 500 || not simulation.times.IsEmpty || current.initials.Length > 64 || simulation.plots.IsEmpty then
                fail "SPATIAL_LIMIT" "Spatial runs require 1..500 output points, at most 64 species, nonempty plots and no explicit output times."
            let diffusion = settings.default_diffusion :: (settings.diffusibles |> List.map (snd >> eval))
            if diffusion |> List.exists (fun value -> not (Double.IsFinite value) || value < 0.0) then fail "SPATIAL_DIFFUSION" "Diffusion coefficients must be finite and nonnegative."
            let cells = pown (int64 settings.nx) settings.dimensions
            samples <- samples + cells * int64 (simulation.points + 1) * int64 simulation.plots.Length
            if samples > 200000L then fail "SPATIAL_LIMIT" "Spatial output exceeds 200000 cell values per batch. Reduce the grid, output points or plotted species."
            let dx = settings.xmax / float (settings.nx - 1)
            let diffusibles = Map.ofList settings.diffusibles
            let maximumD = current.initials |> List.map (fun initial -> Map.tryFind (Expression.Key (Key.Species initial.species)) diffusibles |> Option.map eval |> Option.defaultValue settings.default_diffusion) |> List.max
            let duration = simulation.final - simulation.initial
            let requestedDt = if settings.dt > 0.0 then settings.dt elif maximumD > 0.0 then 0.2 * dx * dx / maximumD else duration / (float simulation.points * 10.0)
            let thin = max 1.0 (ceil (duration / (float simulation.points * requestedDt)))
            let steps = thin * float simulation.points
            if not (Double.IsFinite steps) || steps > 100000.0 || steps * float cells * float current.initials.Length > 50000000.0 then fail "SPATIAL_LIMIT" "Spatial integration exceeds the interactive work limit. Increase dt or reduce the grid and time range."
            let coordinates = Array.init settings.nx (fun i -> float i * settings.xmax / float (settings.nx - 1))
            let times, columns =
                if settings.dimensions = 1 then
                    let pde = current.to_pde1d()
                    if pde.populations.index_to_species |> Array.exists (fun population -> population.value |> Array.exists (fun value -> not (Double.IsFinite value) || value < 0.0)) then fail "SPATIAL_INITIALS" "Spatial initial concentrations must be finite and nonnegative."
                    let _, table = pde |> Pde<float[]>.simulate_1d
                    table.times, table.columns |> List.map (fun column -> column.name, column.values |> List.toArray)
                else
                    let pde = current.to_pde2d()
                    if pde.populations.index_to_species |> Array.exists (fun population -> population.value |> Array.exists (Array.exists (fun value -> not (Double.IsFinite value) || value < 0.0))) then fail "SPATIAL_INITIALS" "Spatial initial concentrations must be finite and nonnegative."
                    let _, table = pde |> Pde<float[][]>.simulate_2d
                    table.times, table.columns |> List.map (fun column -> column.name, column.values |> List.map (Array.collect id) |> List.toArray)
            let columns = columns |> List.map (fun (name, frames) ->
                if frames.Length <> simulation.points + 1 || frames |> Array.exists (fun frame -> frame.Length <> int cells || frame |> Array.exists (Double.IsFinite >> not)) then
                    fail "SPATIAL_NUMERICS" "The spatial solver produced nonfinite or malformed grid values. Reduce dt."
                SpatialSeriesData(name, frames)) |> List.toArray
            let effectiveNx = if settings.boundary = Boundary.Periodic then settings.nx - 1 else settings.nx
            let mean (frame: float[]) =
                seq { for x in 0 .. effectiveNx - 1 do
                          for y in 0 .. (if settings.dimensions = 1 then 0 else effectiveNx - 1) do
                              yield frame.[if settings.dimensions = 1 then x else x * settings.nx + y] } |> Seq.average
            let table = { Table.times = times; columns = columns |> Array.map (fun column -> { Column.name = column.Name; values = column.Frames |> Array.map mean |> Array.toList }) |> Array.toList }
            let data = SpatialData(settings.dimensions, settings.boundary.ToString(), coordinates, (if settings.dimensions = 1 then [||] else coordinates), duration / steps, columns)
            instance, table, data) |> List.toArray
