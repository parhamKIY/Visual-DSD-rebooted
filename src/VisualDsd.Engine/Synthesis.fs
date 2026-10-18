namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open Microsoft.Research.Biology.StabilityZ3
open VisualDsd.Contracts

module internal Synthesis =
    let private fail code message = raise (ExecutionFailure(code, message))
    let private finite value =
        if not (Double.IsFinite value) then fail "SYNTHESIS_NUMERIC" "The synthesized witness could not be represented with finite double precision."
        value

    // The symbolic solver accepts rational functions with integer powers. Reject
    // other expressions before differentiation, rather than silently approximating them.
    let private checkExpression expression =
        let mutable count = 0
        let rec check = function
            | Expression.Float value -> finite value |> ignore
            | Expression.Key _ -> ()
            | Expression.Plus terms | Expression.Times terms -> terms |> List.iter visit
            | Expression.Minus p -> visit p.sub1; visit p.sub2
            | Expression.Divide p -> visit p.div1; visit p.div2
            | Expression.Power p ->
                match p.exponent with
                | Expression.Float n when Double.IsFinite n && Math.Round n = n && abs n <= 16.0 -> visit p.base_
                | _ -> fail "SYNTHESIS_EXPRESSION" "Synthesis requires rational expressions with integer powers between -16 and 16."
            | _ -> fail "SYNTHESIS_EXPRESSION" "Synthesis supports polynomial and rational rates; logarithms, conditionals and rounding are unavailable."
        and visit e =
            count <- count + 1
            if count > 4096 then fail "SYNTHESIS_LIMIT" "A symbolic expression exceeds 4096 terms."
            check e
        visit expression

    let private equilibrium (system: Dynamical) (values: Map<string,float>) suffix name =
        let environment =
            system.State |> Array.fold (fun env species ->
                let key = species + suffix
                match Map.tryFind key values with
                | Some value -> Map.add species value env
                | None -> fail "SYNTHESIS_NUMERIC" (sprintf "The witness omits equilibrium variable %s." key)) values
        let evaluate = Expression.eval (fun key -> Map.find key environment) >> finite
        let state = system.State |> Array.map (fun key -> environment.[key])
        let residuals = system.Eqns |> Array.map evaluate
        let rec magnitude = function
            | Expression.Plus terms -> terms |> List.sumBy magnitude
            | Expression.Minus parts -> magnitude parts.sub1 + magnitude parts.sub2
            | other -> abs (evaluate other)
        Array.iter2 (fun expression residual ->
            if abs residual > 1e-8 * max 1.0 (magnitude expression) then
                fail "SYNTHESIS_NUMERIC" "The rounded witness does not satisfy the equilibrium equations to numerical tolerance.") system.Eqns residuals
        let jacobian = system.J().values |> Array.map (fun row -> row.values |> Array.map evaluate)
        let matrix = MathNet.Numerics.LinearAlgebra.Double.DenseMatrix.OfRowArrays jacobian
        let maximum = matrix.Evd().EigenValues |> Seq.map (fun eigenvalue -> eigenvalue.Real) |> Seq.max |> finite
        EquilibriumData(name, system.State, state, residuals, maximum, jacobian)

    let private portrait (request: ModelRequest) (crn: Crn) (values: Map<string,float>) (equilibria: EquilibriumData[]) seed =
        if request.PhaseTrajectories = 0 || equilibria.[0].Species.Length < 2 then
            if not (isNull request.PhaseX) then fail "SYNTHESIS_PHASE" "The phase portrait requires at least two species and one trajectory."
            null
        else
            let species = equilibria.[0].Species
            let x = if isNull request.PhaseX then species.[0] else request.PhaseX
            let y = if isNull request.PhaseY then species.[1] else request.PhaseY
            let xi, yi = Array.tryFindIndex ((=) x) species, Array.tryFindIndex ((=) y) species
            if x = y || xi.IsNone || yi.IsNone then fail "SYNTHESIS_PHASE" "Choose two distinct species present in the synthesized system."
            let xeq = equilibria |> Array.map (fun eq -> eq.Values.[xi.Value])
            let yeq = equilibria |> Array.map (fun eq -> eq.Values.[yi.Value])
            let xmax, ymax = max 1e-6 (Array.max xeq * 1.5), max 1e-6 (Array.max yeq * 1.5)
            let rng = match seed with Some value -> Rng.Random(value) | None -> Rng.Random()
            let sim = crn.settings.simulation
            if not (Double.IsFinite sim.initial && Double.IsFinite sim.final) || sim.final <= sim.initial then
                fail "SYNTHESIS_PHASE" "Phase trajectories require a finite positive simulation interval."
            let tolerances = crn.settings.deterministic
            if not (Double.IsFinite tolerances.abstolerance && Double.IsFinite tolerances.reltolerance) || min tolerances.abstolerance tolerances.reltolerance <= 0.0 then
                fail "INVALID_TOLERANCE" "Phase trajectories require positive finite solver tolerances."
            let parameters = crn.settings.parameters |> List.map (fun p -> match Map.tryFind p.name values with Some v -> {p with value=v} | None -> p)
            let plots = [x;y] |> List.map (Species.create >> Key.Species >> Expression.Key)
            let trajectories = Array.init request.PhaseTrajectories (fun _ ->
                let initialX, initialY = rng.NextDouble() * xmax, rng.NextDouble() * ymax
                let initials = crn.initials |> List.map (fun initial ->
                    if initial.species.name = x then {initial with value=Expression.Float initialX}
                    elif initial.species.name = y then {initial with value=Expression.Float initialY}
                    else initial)
                let updated = {crn with initials=initials; settings={crn.settings with parameters=parameters; sweeps=[]; simulations=[]; simulator=Simulator.Sundials; simulation={sim with plots=plots; points=min 200 (max 1 sim.points); times=[]}}}
                let table = updated.to_sundials().simulate()
                let times = table.times |> List.map finite |> List.toArray
                let xs = table.columns.[0].values |> List.map finite |> List.toArray
                let ys = table.columns.[1].values |> List.map finite |> List.toArray
                if times.Length = 0 || times.Length <> xs.Length || xs.Length <> ys.Length then fail "SYNTHESIS_NUMERIC" "A phase trajectory has inconsistent samples."
                let distances = Array.map2 (fun ex ey -> sqrt ((ex-Array.last xs)**2.0 + (ey-Array.last ys)**2.0)) xeq yeq
                let nearest = if distances.[0] < distances.[1] then 0 else 1
                PhaseTrajectoryData(initialX,initialY,times,xs,ys,nearest,distances.[nearest]))
            PhasePortraitData(x,y,xeq,yeq,trajectories)

    let run (request: ModelRequest) (crn: Crn) =
        let grouped = crn.initials |> List.groupBy (fun initial -> initial.species)
        if grouped.IsEmpty || grouped.Length > 8 || crn.reactions.Length > 128 || crn.settings.parameters.Length > 32 then
            fail "SYNTHESIS_LIMIT" "Synthesis supports 1–8 species, at most 128 reactions and 32 parameters per selected system."
        if not crn.settings.sweeps.IsEmpty || not crn.settings.simulations.IsEmpty then
            fail "SYNTHESIS_BATCH" "Select a single system without parameter sweeps or named simulation batches for synthesis."
        if crn.initials |> List.exists (fun initial -> initial.time.IsSome || initial.spatial.IsSome) then
            fail "SYNTHESIS_INITIALS" "Equilibrium synthesis requires homogeneous initials without timed population inputs."
        let initials =
            grouped |> List.map (fun (_,entries) ->
                if entries |> List.exists (fun i -> i.constant <> entries.Head.constant) then
                    fail "SYNTHESIS_INITIALS" "A species cannot mix constant and variable initial contributions."
                {entries.Head with value=Expression.Plus (entries |> List.map (fun i -> i.value)) |> Expression.simplify})
        let crn = {crn with initials=initials}
        let settings = crn.settings.synthesis
        let timeout = settings.timeout |> Option.defaultValue (float request.TimeoutSeconds - 1.0 |> max 0.1)
        if not (Double.IsFinite timeout) || timeout <= 0.0 || timeout > float request.TimeoutSeconds then
            fail "SYNTHESIS_TIMEOUT" "The synthesis timeout must be positive and no greater than the request timeout."
        let seed = if request.Seed.HasValue then Some request.Seed.Value else settings.seed
        let parameterNames = crn.settings.parameters |> List.map (fun p -> p.name) |> Set.ofList
        let speciesNames = crn.initials |> List.map (fun i -> i.species.name) |> Set.ofList
        if not (Set.intersect parameterNames speciesNames).IsEmpty || parameterNames.Count <> crn.settings.parameters.Length then
            fail "SYNTHESIS_NAMES" "Species and parameter names must be distinct; parameters cannot be duplicated."
        let symbols = Set.union parameterNames speciesNames
        if symbols.Contains "w" || symbols.Contains "wc" || symbols.Contains "wzc" || symbols.Contains "w_2" || speciesNames |> Set.exists (fun name -> symbols.Contains (name+"_1") || symbols.Contains (name+"_2")) then
            fail "SYNTHESIS_NAMES" "Names collide with reserved wave-number or equilibrium variables (w, w_2, species_1, species_2)."
        // Detect named-rate cycles before the original recursive inliner is entered.
        let rec visitRate path name =
            if Set.contains name path then fail "SYNTHESIS_RATES" "Named functional rates must not contain cycles."
            match Map.tryFind name crn.settings.rates with
            | None -> fail "SYNTHESIS_RATES" (sprintf "Undefined named rate %s." name)
            | Some expression ->
                Expression.mentions expression |> List.iter (function Key.Rate rate -> visitRate (Set.add name path) rate | _ -> ())
        crn.settings.rates |> Map.iter (fun name _ -> visitRate Set.empty name)
        for parameter in crn.settings.parameters do finite parameter.value |> ignore
        let system = Dynamical.fromCRN crn
        let synthesisParameters = Set.difference system.GetVars speciesNames
        if synthesisParameters.Count > 32 then fail "SYNTHESIS_LIMIT" "Synthesis supports at most 32 parameters, including implicit rate and diffusion variables."
        let allSymbols = Set.union symbols synthesisParameters
        if allSymbols.Contains "w" || allSymbols.Contains "wc" || allSymbols.Contains "wzc" || allSymbols.Contains "w_2" || speciesNames |> Set.exists (fun name -> allSymbols.Contains (name+"_1") || allSymbols.Contains (name+"_2")) then
            fail "SYNTHESIS_NAMES" "Implicit parameters collide with reserved wave-number or equilibrium variables."
        for expression in system.Eqns do checkExpression expression
        for KeyValue(_,expression) in system.diffusion do checkExpression expression
        for KeyValue(_, (low,high)) in system.bounds do
            low |> Option.iter (finite >> ignore); high |> Option.iter (finite >> ignore)
            if low.IsSome && high.IsSome && low.Value > high.Value then fail "SYNTHESIS_BOUNDS" "A synthesis parameter has reversed bounds."
        let isTuring = settings.mode = Synthesis_mode.Turing
        if isTuring && system.diffusion.IsEmpty then fail "SYNTHESIS_DIFFUSION" "Turing synthesis requires explicit diffusible species in directive spatial."
        let milliseconds = uint32 (max 1.0 (Math.Ceiling (1000.0 * timeout)))
        let solver = match settings.solver with Z3Solver.NLSat -> Solver.NlsatTO milliseconds | Z3Solver.Portfolio -> Solver.PortfolioTO milliseconds
        let result =
            try
                if isTuring then
                    Solver.CheckTuring true solver {TuringSymbolic.TuringAnalysisSettings.Default with print_status=false; seed=seed} system
                else Solver.CheckBistability true solver false seed system
            with error -> fail "SYNTHESIS_SOLVER" error.Message
        let witness = match result.solution with AnalysisResult.SAT (values,_) -> Some values | AnalysisResult.FAILED (error,_) -> fail "SYNTHESIS_SOLVER" error | _ -> None
        let values = witness |> Option.defaultValue Map.empty
        values |> Map.iter (fun _ value -> finite value |> ignore)
        let equilibria =
            match witness with
            | None -> [||]
            | Some values when isTuring -> [|equilibrium system values "" "Homogeneous equilibrium"|]
            | Some values -> [|equilibrium system values "_1" "Equilibrium 1"; equilibrium system values "_2" "Equilibrium 2"|]
        if equilibria.Length = 2 && Array.forall2 (=) equilibria.[0].Values equilibria.[1].Values then
            fail "SYNTHESIS_NUMERIC" "The distinct symbolic equilibria collapse to identical double-precision values."
        let dispersion =
            if not isTuring || witness.IsNone then null
            else
                let squared = Map.tryFind "wc" values |> Option.defaultWith (fun () -> fail "SYNTHESIS_NUMERIC" "The Turing witness omits its squared wave number.")
                if squared <= 0.0 then fail "SYNTHESIS_NUMERIC" "The Turing witness has no positive wave number."
                let wave = sqrt squared
                let waves = MathNet.Numerics.Generate.LogSpaced(121, log10 wave - 2.0, log10 wave + 2.0) |> Array.append [|0.0;wave|] |> Array.distinct |> Array.sort
                let growth = TuringNumerical.dispersion waves result |> Array.map finite
                let witnessGrowth = TuringNumerical.dispersion [|wave|] result |> Array.head |> finite
                DispersionData(waves,growth,wave,witnessGrowth)
        let assignedParameters =
            let declared = crn.settings.parameters |> List.map (fun p -> match Map.tryFind p.name values with Some v -> {p with value=v} | None -> p)
            let implicit = Set.difference synthesisParameters parameterNames |> Set.toList |> List.choose (fun name ->
                Map.tryFind name values |> Option.map (fun value -> Parameter.create(name,value,None)))
            declared @ implicit
        let assigned = {crn with settings={crn.settings with parameters=assignedParameters}}
        let phase = if isTuring || witness.IsNone then null else portrait request assigned values equilibria seed
        let updated =
            if witness.IsNone then null
            else
                let diffusibles = crn.settings.spatial.diffusibles |> List.map (fun (sp,rate) -> sp,Expression.substitute (values |> Map.map (fun _ v -> Expression.Float v)) rate)
                {assigned with settings={assigned.settings with spatial={crn.settings.spatial with diffusibles=diffusibles}}}.to_string()
        let ode,jacobian,diffusion,constraints = system.ToEquationsSplit false false
        let entries = values |> Map.toArray |> Array.map (fun (name,value) ->
            let kind = if synthesisParameters.Contains name then "parameter" elif symbols.Contains name || speciesNames |> Set.exists (fun species -> name=species+"_1" || name=species+"_2") then "equilibrium" else "auxiliary"
            let low,high = Map.tryFind name result.bounds |> Option.defaultValue (None,None)
            SynthesisValueData(name,kind,value,low |> Option.map Nullable |> Option.defaultValue (Nullable()),high |> Option.map Nullable |> Option.defaultValue (Nullable())))
        SynthesisData((if isTuring then "turing" else "multistability"),(if settings.solver=Z3Solver.NLSat then "nlsat" else "portfolio"),result.solution.Status,
                      max 0.0 result.solution.Time,entries,ode,jacobian,diffusion,constraints,equilibria,dispersion,phase,updated,seed |> Option.map Nullable |> Option.defaultValue (Nullable()))
