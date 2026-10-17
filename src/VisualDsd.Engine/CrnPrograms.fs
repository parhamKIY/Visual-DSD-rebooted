namespace VisualDsd.Engine

open System
open Microsoft.Research.CRNEngine
open Microsoft.Research.CRNEngine.InferenceSiteGraph
open VisualDsd.Contracts
open Parser

module internal CrnPrograms =
    let fail code message = raise (ExecutionFailure(code, message))

    // Keep the original grammar, while rejecting declarations that Map.ofList would silently overwrite.
    let private parser =
        parseTask .>>. Model.parse
        >>= fun (task, model) ->
            let names = model.systems |> List.map (fun crn -> crn.name)
            if names.Length <> (List.distinct names).Length then fail "CRN_DUPLICATE" "System names must be unique."
            if names.Length > 64 then fail "CRN_LIMIT" "A program supports at most 64 system definitions."
            let definitions = model.systems |> List.map (fun crn -> crn.name, crn) |> Map.ofList
            let graph lines =
                let nodes = lines |> List.choose (function Choice1Of2 node -> Some node | _ -> None)
                let ids = nodes |> List.map (fun node -> node.top.name)
                if ids.Length <> (List.distinct ids).Length then fail "CRN_DUPLICATE" "Node names must be unique."
                let edges = lines |> List.choose (function Choice2Of2 edge -> Some edge | _ -> None)
                { task = task; nodes = nodes |> List.map (fun node -> node.top.name, node) |> Map.ofList
                  edges = edges |> List.groupBy (fun (source,_,_) -> source) |> Map.ofList |> Map.map (fun _ entries -> entries |> List.map (fun (_,props,target) -> target,props))
                  expanded = false }
            Parser.choice [ Parser.many1 (pline model definitions) |>> graph
                            Parser.preturn { task = task; nodes = Map.ofList [model.top.name, model]; edges = Map.empty; expanded = false } ]

    let parse (request: ModelRequest) =
        let graph = Parser.from_string parser request.Code
        if graph.nodes.IsEmpty || graph.nodes.Count > 32 then fail "CRN_LIMIT" "A program requires 1–32 model nodes."
        let mutable systemCount = 0
        for KeyValue(id,model) in graph.nodes do
            let names = model.systems |> List.map (fun system -> system.name)
            if id.Length > 128 || names |> List.exists (fun name -> name.Length > 128) then fail "CRN_LIMIT" "Node and system identifiers cannot exceed 128 characters."
            if names.Length <> (List.distinct names).Length then fail "CRN_DUPLICATE" "A node cannot select the same system more than once."
            systemCount <- systemCount + names.Length + 1
        if systemCount > 256 then fail "CRN_LIMIT" "A program supports at most 256 node/system combinations."
        let location loc =
            match loc with NodeLoc node -> CrnLocationData(node, "") | SystemLoc (node,system) -> CrnLocationData(node, system)
        let resolve loc =
            let id = toNodeID loc
            let model = Map.tryFind id graph.nodes |> Option.defaultWith (fun () -> fail "CRN_REFERENCE" (sprintf "Undefined node %s." id))
            match loc with
            | NodeLoc _ -> model.top
            | SystemLoc (_,system) ->
                let crn = model.systems |> List.tryFind (fun item -> item.name = system) |> Option.defaultWith (fun () -> fail "CRN_REFERENCE" (sprintf "Undefined system %s.%s." id system))
                { crn with settings = { crn.settings with parameters = model.top.settings.parameters @ crn.settings.parameters } }
        let edges = graph.edges |> Map.toList |> List.collect (fun (source,targets) ->
            let from = resolve source
            targets |> List.map (fun (target,parameters) ->
                let dest = resolve target
                match source,target with
                | NodeLoc _,SystemLoc _ | SystemLoc _,NodeLoc _ -> fail "CRN_REFERENCE" "Links must connect two model nodes or two systems."
                | _ -> ()
                for (a,b,_) in parameters do
                    if a.Length > 128 || b.Length > 128 then fail "CRN_LIMIT" "Linked parameter identifiers cannot exceed 128 characters."
                    if not (from.settings.parameters |> List.exists (fun p -> p.name = a)) || not (dest.settings.parameters |> List.exists (fun p -> p.name = b)) then
                        fail "CRN_REFERENCE" (sprintf "An edge between %s and %s refers to an undefined parameter." source.to_string target.to_string)
                CrnEdgeData(location source, location target, parameters |> List.map (fun (a,b,kind) -> CrnPriorData(a,b,kind.to_string)) |> List.toArray))) |> List.toArray
        if edges.Length > 128 || (edges |> Array.sumBy (fun edge -> edge.Parameters.Length)) > 1024 then fail "CRN_LIMIT" "The model graph exceeds 128 edges or 1024 parameter mappings."
        // A graph is editable before inference; detect cycles without invoking the recursive inference runner.
        let remaining = Collections.Generic.HashSet<string>(graph.nodes |> Map.toSeq |> Seq.map fst)
        let mutable changed = true
        while changed && remaining.Count > 0 do
            let roots = remaining |> Seq.filter (fun id -> edges |> Array.forall (fun edge -> edge.Target.NodeId <> id || not (remaining.Contains edge.Source.NodeId))) |> Seq.toArray
            changed <- roots.Length > 0
            roots |> Array.iter (fun id -> remaining.Remove id |> ignore)
        if remaining.Count > 0 then fail "CRN_GRAPH_CYCLE" "Inference model links must form a directed acyclic graph."
        let nodeId = if isNull request.NodeId then graph.nodes |> Map.toSeq |> Seq.head |> fst else request.NodeId
        let node = Map.tryFind nodeId graph.nodes |> Option.defaultWith (fun () -> fail "CRN_SELECTION" (sprintf "Unknown model node %s." nodeId))
        let systemId =
            if not (isNull request.SystemId) then request.SystemId
            elif node.top.initials.IsEmpty && node.top.reactions.IsEmpty && not node.systems.IsEmpty then node.systems.Head.name
            else ""
        // Match the original model preparation: expand local parameters/sweeps, lift names,
        // and merge shared functional rates before selecting a system.
        let prepared, _ = node.expandAndLift()
        let prepared = prepared.merge_shared_settings()
        let selected =
            if systemId = "" then prepared.top
            else prepared.systems |> List.tryFind (fun system -> system.name = systemId) |> Option.defaultWith (fun () -> fail "CRN_SELECTION" (sprintf "Unknown system %s.%s." nodeId systemId))
        let systemInfo id (crn: Crn) =
            let crn = crn.saturate_initials()
            if crn.initials.Length > 10000 || crn.reactions.Length > 50000 then fail "MODEL_TOO_LARGE" "A system exceeds the interactive network limit."
            CrnSystemData(id, crn.initials |> List.map (fun initial -> initial.species) |> List.distinct |> List.length, crn.reactions.Length)
        let nodes = graph.nodes |> Map.toArray |> Array.map (fun (id,model) ->
            CrnNodeData(id, Array.ofList (systemInfo "" model.top :: (model.systems |> List.map (fun system -> systemInfo system.name system)))))
        selected.saturate_initials(), CrnProgramData(request.Code, nodes, edges, nodeId, systemId), graph
