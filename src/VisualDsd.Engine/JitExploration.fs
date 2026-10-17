namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

module internal JitExploration =
    let run (original: Crn) jit calculus =
        let result, namer, reactions =
            try Jit.to_ctmc_bounded 1000 jit calculus
            with error ->
                let code = if error.Message.Contains("exceeds", StringComparison.Ordinal) then "STATE_SPACE_LIMIT" else "JIT_STATE_SPACE"
                raise (ExecutionFailure(code, error.Message))
        let names = result.to_species |> Seq.map namer |> Seq.toArray
        if (names |> Array.map (fun a -> a.name) |> Array.distinct).Length <> names.Length then
            raise (ExecutionFailure("JIT_SPECIES_ID", "Generated species identifiers are not unique."))
        let index = result.to_species |> Seq.mapi (fun i sp -> sp, i) |> Map.ofSeq
        let species sp = Species.create names.[index.[sp]].name
        let initial = names |> Array.mapi (fun i attr ->
            let n = Map.tryFind i result.ctmc.initial_state |> Option.defaultValue 0
            Initial.create(false, Expression.Float (float n), Species.create attr.name, None, None)) |> Array.toList
        let crn = Crn.create original.name original.settings (reactions |> List.map (Reaction.map species id (Expression.map (Key.map species)))) initial
                    (names |> Array.map (fun attr -> attr.name, attr) |> Map.ofArray) true
        let states = result.ctmc.graph |> Dictionary.keys |> Seq.toArray
        let stateIndex = states |> Array.mapi (fun i state -> state, i) |> Map.ofArray
        let values = states |> Array.map (fun state -> Array.init names.Length (fun i ->
            let n = Map.tryFind i state |> Option.defaultValue 0
            if n < 0 || n > 1000000 then raise (ExecutionFailure("STATE_SPACE_LIMIT", "A reachable population exceeds 1000000."))
            n))
        for state in states do
            for edge in Dictionary.find result.ctmc.graph state do
                let rate = Expression.eval (fun _ -> failwith "Unresolved JIT parameter.") edge.propensity
                if not (Double.IsFinite rate) || rate < 0.0 then raise (ExecutionFailure("STATE_SPACE_RATE", "JIT transition rates must be finite and nonnegative."))
        let edges = states |> Array.mapi (fun i state ->
            Dictionary.find result.ctmc.graph state |> List.filter (fun edge -> edge.target <> state)
            |> List.groupBy (fun edge -> stateIndex.[edge.target]) |> List.map (fun (target, group) ->
                let rate = group |> List.sumBy (fun edge -> Expression.eval (fun _ -> failwith "Unresolved JIT parameter.") edge.propensity)
                if not (Double.IsFinite rate) || rate <= 0.0 then raise (ExecutionFailure("STATE_SPACE_RATE", "JIT transition rates must be finite and positive."))
                StateTransitionData(i, target, rate)) |> List.toArray) |> Array.concat
        crn, StateSpaceData(names |> Array.map (fun attr -> attr.name), stateIndex.[result.ctmc.initial_state], values, edges)
