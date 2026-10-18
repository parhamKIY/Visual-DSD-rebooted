// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.Research.CRNEngine
open Operators

[<JavaScript>]
type Synthesis_mode =
 | [<WebSharper.Constant "Multistability">] Multistability
 | [<WebSharper.Constant "Turing">] Turing
[<JavaScript>]
type Z3Solver =
 | [<WebSharper.Constant "NLSat">] NLSat
 | [<WebSharper.Constant "Portfolio">]  Portfolio
[<JavaScript>]
type Synthesis_settings = 
  { mode : Synthesis_mode
  ; solver : Z3Solver
  ; timeout : float option
  ; seed : int option
  }
  static member defaults = {
    mode = Multistability
    solver = Portfolio
    timeout = None
    seed = None
  }
  static member parse_defaults defaults = 
    Parser.record defaults [
      "mode", Parser.choice [
        Parser.kw "multistability" |>> fun _ s -> { s with mode = Multistability};
        Parser.kw "turing"         |>> fun _ s -> { s with mode = Turing }; 
      ]
      "solver", Parser.choice [
        Parser.kw "nlsat"     |>> fun _ s -> { s with solver = NLSat }
        Parser.kw "portfolio" |>> fun _ s -> { s with solver = Portfolio }
      ]
      "timeout", Parser.pfloat |>> fun t s -> { s with timeout = Some t }
      "seed", Parser.pint32 |>> fun t s -> { s with seed = Some t }
    ]
  static member parse = Synthesis_settings.parse_defaults Synthesis_settings.defaults
  static member from_string (s:string) = Parser.from_string Synthesis_settings.parse s

  static member to_string (settings:Synthesis_settings) =
    let mode = match settings.mode with Multistability -> "multistability" | Turing -> "turing"
    let solver = match settings.solver with NLSat -> "nlsat" | Portfolio -> "portfolio"
    let timeout = settings.timeout |> Option.map (fun t -> ";timeout=" + t.ToString("R",System.Globalization.CultureInfo.InvariantCulture)) |> Option.defaultValue ""
    let seed = settings.seed |> Option.map (sprintf ";seed=%d") |> Option.defaultValue ""
    sprintf "{mode=%s;solver=%s%s%s}" mode solver timeout seed
