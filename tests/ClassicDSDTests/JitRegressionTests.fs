module VisualDsd.Rebooted.JitRegressionTests

open Xunit
open Microsoft.Research.CRNEngine

let private create stochastic =
    let settings : Simulation_settings<Expression.t<Inlined<string>>> =
        { Simulation_settings.defaults with final = 1.0; points = 100; seed = Some 42 }
    let initials = ["A",1.0; "B",0.0; "C",0.0] |> List.map (fun (name,value) -> Initial.create(Expression.Float value, name))
    let reaction : Reaction<string,float,Expression.t<Inlined<string>>> =
        Reaction.create(["A"], (None, Rate.MassAction 100.0), ["C"])
    let printSpecies name : Jit.newplottable = { name = name; structural = None; svg = None }
    let state = Jit.create settings stochastic Map.empty [] ["A"] initials [reaction] printSpecies (=) (=)
    let calculus : Calculus<string> =
        { react = fun _ species ->
            if species = "C" then [Reaction.create(["C"], (None, Rate.MassAction (Expression.Float 100.0)), ["B"])]
            else [] }
    state, calculus

[<Fact>]
let ``JIT columns follow discovery order even when dictionary order is different`` () =
    let state, calculus = create Stochastic_settings.defaults
    let final, table = Jit.simulate state calculus
    Assert.Equal<string list>(["A"; "C"; "B"], table.columns |> List.map (fun column -> column.name))
    Assert.Equal<float list>([0.0; 0.0; 1.0], table.columns |> List.map (fun column -> List.last column.values))
    Assert.Equal(1.0, List.last table.times)
    Assert.Equal(1.0, final |> Jit.get_species |> List.sumBy (fun initial -> Expression.eval (fun _ -> 0.0) initial.value))

[<Fact>]
let ``JIT step budget is fixed at the start of a run`` () =
    let state, calculus = create { Stochastic_settings.defaults with steps = Some 1 }
    let final, _ = Jit.simulate state calculus
    let population name = final |> Jit.get_species |> List.find (fun initial -> initial.species = name) |> fun initial -> Expression.eval (fun _ -> 0.0) initial.value
    Assert.Equal(0.0, population "A")
    Assert.Equal(1.0, population "C")
    Assert.Equal(0.0, population "B")
