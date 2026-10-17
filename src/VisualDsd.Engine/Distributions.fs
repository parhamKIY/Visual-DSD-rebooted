namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal Distributions =
    let maximumValues = 200000
    let fail message = raise (ExecutionFailure("PROBABILITY_NUMERICS", message))

    let prepare (crn: Crn) (times: float list) (raw: Probabilities) =
        let names = raw.species |> Hashtable.to_list |> List.sortBy snd |> List.map fst |> List.toArray
        let states = raw.stoichiometry |> Array.map (Array.map (fun n ->
            if not (Double.IsFinite n) || n < 0.0 || n > 1000000.0 || Math.Round n <> n then fail "Invalid state population in CME output."
            int n))
        let stamps, rows = List.toArray raw.times, List.toArray raw.stateprobabilities
        if stamps.Length = 0 || stamps.Length <> rows.Length || states.Length = 0 ||
           states |> Array.exists (fun row -> row.Length <> names.Length) then fail "CME returned an incomplete probability table."
        if int64 times.Length * int64 states.Length > int64 maximumValues then
            raise (ExecutionFailure("PROBABILITY_LIMIT", "Probability output exceeds 200000 state values. Reduce output points or the state space."))
        let mutable cursor = 0
        let mutable maximumError = 0.0
        let mass = times |> List.map (fun t ->
            while cursor + 1 < stamps.Length && stamps.[cursor + 1] <= t do cursor <- cursor + 1
            if t < stamps.[0] || t > stamps.[stamps.Length - 1] then fail "Probability samples do not cover the requested times."
            let values =
                if stamps.[cursor] = t then Array.copy rows.[cursor]
                else Array.map2 (Row<float>.interpolate_float t stamps.[cursor] stamps.[cursor + 1]) rows.[cursor] rows.[cursor + 1]
            if values.Length <> states.Length || values |> Array.exists (fun p -> not (Double.IsFinite p) || p < -1e-7 || p > 1.00001) then
                fail "CME returned an invalid probability. Tighten the deterministic solver tolerances."
            let total = Array.sum values
            maximumError <- max maximumError (abs (total - 1.0))
            if abs (total - 1.0) > 1e-5 then fail "CME probability mass is not conserved. Tighten the deterministic solver tolerances."
            // Remove only roundoff-sized negatives, then retain a normalized distribution.
            let nonnegative = values |> Array.map (max 0.0)
            let normalizer = Array.sum nonnegative
            maximumError <- max maximumError (abs (normalizer - 1.0))
            if abs (normalizer - 1.0) > 1e-5 then fail "CME requires excessive probability correction. Tighten the deterministic solver tolerances."
            nonnegative |> Array.map (fun p -> p / normalizer)) |> List.toArray
        let env = Parameters.to_env crn.settings.parameters
        let inlinePlot = Expression.expand (Key.inline_keys env (Key.inline_rates_env env crn.settings.rates)) >> Expression.map (Inlined.map (fun sp -> Array.findIndex ((=) sp.name) names))
        let plots = crn.settings.simulation.plots |> List.map (fun plot -> plot, inlinePlot plot)
        let columns = plots |> List.map (fun (plot, expression) ->
            let points = Array.map2 (fun time row ->
                let values = states |> Array.map (fun state ->
                    let key = function Inlined.Species sp -> float state.[sp] | Inlined.Time -> time
                    Expression.eval key expression)
                if values |> Array.exists (Double.IsFinite >> not) then fail "A probability plot is nonfinite in a reachable state."
                let mean = Array.map2 (*) row values |> Array.sum
                let variance = Array.map2 (fun p value -> p * pown (value - mean) 2) row values |> Array.sum
                Point.create mean (sqrt variance)) (List.toArray times) mass |> Array.toList
            { Column.name = Functional2.to_string_plot plot; values = points })
        ProbabilityData(names, states, mass, maximumError), { Table.times = times; columns = columns }
