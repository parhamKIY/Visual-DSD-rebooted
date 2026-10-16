module VisualDsd.Rebooted.GraphResolutionTests

open Xunit
open Microsoft.Research.DNA
open RulesDSD.Syntax
open RulesDSD.Resolution

let private components predicate =
    let cle = LogicDSD.engine
    let parseProcess code = Parser.from_string (RulesDSD.Parser.psystem (LogicDSD.psite cle (makeProvider()) false)) code
    let a, b, c = parseProcess "<a>", parseProcess "<b>", parseProcess "<c>"
    let edges = TList [TList [Proc a; TList [Proc b]]; TList [Proc b; TList [Proc a; Proc c]]; TList [Proc c; TList [Proc c]]]
    let result = Term.Var(0, "Components")
    let solutions = resolveAll (Pos(Pred(predicate, [edges; result]))) (System.Collections.Generic.Dictionary<_, _>()) cle |> Option.get
    match solutions.Head.Apply(result, cle) with
    | TList groups ->
        groups |> List.map (function
            | TList members -> members |> List.map (Term.ToStringWith cle) |> Set.ofList
            | _ -> failwith "Expected a component list") |> Set.ofList
    | _ -> failwith "Expected strongly connected components"

[<Fact>]
let ``strongly connected components preserve cycles and separate sinks`` () =
    let expected = Set.ofList [Set.ofList ["<a>"; "<b>"]; Set.singleton "<c>"]
    Assert.True((expected = components "scc"))

[<Fact>]
let ``terminal components exclude cycles with outgoing edges`` () =
    Assert.True(Set.singleton (Set.singleton "<c>") = components "tscc")
