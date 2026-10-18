namespace VisualDsd.Engine

open System
open System.Globalization
open System.Xml.Linq
open MathNet.Symbolics
open Microsoft.Research.CRNEngine
open VisualDsd.Contracts

/// Scientific files share one deterministic concentration model, resolved per batch instance.
/// No stochastic propensity, diffusion, or delayed input is silently approximated.
module Exports =
    module E = Microsoft.Research.CRNEngine.Expression
    let private fail message = raise (ExecutionFailure("EXPORT_UNSUPPORTED", message))
    let private number (value: float) =
        if not (Double.IsFinite value) then fail "An export expression contains a nonfinite number."
        value.ToString("R", CultureInfo.InvariantCulture)
    let private tex (text: string) =
        text |> Seq.map (function
            | '\\' -> "\\backslash{}" | '{' -> "\\{" | '}' -> "\\}"
            | '_' -> "\\_" | '%' -> "\\%" | '&' -> "\\&" | '#' -> "\\#"
            | '$' -> "\\$" | '^' -> "\\textasciicircum{}" | '~' -> "\\textasciitilde{}"
            | c -> string c) |> String.concat ""
    let private quote (text: string) = "'" + text.Replace("'", "''").Replace("\r", " ").Replace("\n", " ") + "'"

    let private portable expression =
        E.visit (function
            | E.Modulo x ->
                let remainder a b =
                    let q=E.Divide{div1=a;div2=b}
                    E.Minus{sub1=a;sub2=E.Times[b;E.If(E.BLT(q,E.Float 0.0),E.Ceiling q,E.Floor q)]}
                Some(remainder (E.Plus[remainder x.div x.modulo;x.modulo]) x.modulo)
            | E.Round x ->
                let lo=E.Floor x
                let fraction=E.Minus{sub1=x;sub2=lo}
                let half=E.Float 0.5
                let even=E.BEq(lo,E.Times[E.Float 2.0;E.Floor(E.Divide{div1=lo;div2=E.Float 2.0})])
                let increment=E.If(E.BOr(E.BGT(fraction,half),E.BAnd(E.BEq(fraction,half),E.BNot even)),E.Float 1.0,E.Float 0.0)
                Some(E.Plus[lo;increment])
            | _ -> None) expression

    type private System = {
        Crn: Crn
        Species: Species array
        Initial: float array
        Constants: bool array
        Reactions: Reaction<Species,Value,Functional> list
        Fluxes: Functional array
        Equations: Functional array
        Plots: Functional array
        Names: string array
    }

    let private prepare (crn: Crn) =
        if crn.settings.simulator = Simulator.PDE || crn.initials |> List.exists (fun i -> i.spatial.IsSome) then
            fail "Spatial diffusion and spatial initial conditions cannot be represented by a well-mixed ODE export."
        if not (List.contains crn.settings.simulator [Simulator.Oslo; Simulator.Sundials; Simulator.MC]) then
            fail "Choose Oslo or Sundials for deterministic concentration exports. Stochastic and statistical solvers have different semantics."
        let env = Parameters.to_env crn.settings.parameters
        let eval = E.eval (Environment.find env)
        let crn = crn.saturate_initials()
        if crn.initials |> List.exists (fun i -> i.time |> Option.exists (fun t -> eval t <> crn.settings.simulation.initial)) then
            fail "Scheduled population inputs require events; this exporter currently supports initial-time populations only."
        let groups = crn.initials |> List.groupBy (fun i -> i.species) |> List.toArray
        if groups.Length = 0 || groups.Length > 256 || crn.reactions.Length > 2048 then
            fail "Scientific dynamics export supports 1–256 species and at most 2048 reactions per run."
        if groups |> Array.exists (fun (_, items) -> items |> List.exists (fun i -> i.constant <> items.Head.constant)) then
            fail "A species has conflicting constant declarations."
        let species = groups |> Array.map fst
        let initial = groups |> Array.map (snd >> List.sumBy (fun i -> eval i.value))
        if initial |> Array.exists (fun v -> not (Double.IsFinite v) || v < 0.0) then fail "Initial populations must be finite and nonnegative."
        let constants = groups |> Array.map (snd >> List.head >> fun i -> i.constant)
        let rec inlineKey path key =
            match key with
            | Key.Parameter name -> E.Float (Environment.find env name)
            | Key.Species _ | Key.Time -> E.Key key
            | Key.Rate name ->
                if Set.contains name path || Set.count path > 64 then fail "Named rates are recursive or exceed 64 nested references."
                match Map.tryFind name crn.settings.rates with
                | None -> fail ("Undefined named rate: " + name)
                | Some expression -> E.expand (inlineKey (Set.add name path)) expression
        let inlineExpression = E.expand (inlineKey Set.empty) >> E.simplify >> portable
        let reactions = crn.reactions |> Reaction.normalise_list
        let fluxes = reactions |> List.map (fun r ->
            match r.rate with
            | Rate.Function expression -> inlineExpression expression
            | Rate.MassAction expression ->
                let coefficient = if crn.settings.simulator = Simulator.Oslo && crn.settings.simulation.kinetics = Kinetics.Stochastic then r.deterministic_to_stochastic expression else expression
                let factors = r.reactants |> List.map (fun entry -> E.Power {base_=E.Key (Key.Species entry.element); exponent=E.Float (float entry.multiplicity)})
                E.Times (E.Float (eval coefficient) :: factors) |> E.simplify) |> List.toArray
        let equations = species |> Array.mapi (fun i sp ->
            if constants.[i] then E.Float 0.0
            else reactions |> List.mapi (fun j r -> E.Times [E.Float (float (r.getStoich false sp)); fluxes.[j]]) |> E.Plus |> E.simplify)
        let plots = crn.settings.simulation.plots |> List.map inlineExpression |> List.toArray
        let available = Set.ofArray species
        for expression in Array.concat [fluxes; plots] do
            for key in E.mentions expression do
                match key with Key.Species sp when not (Set.contains sp available) -> fail ("Unknown species in export expression: " + sp.name) | _ -> ()
        {Crn=crn; Species=species; Initial=initial; Constants=constants; Reactions=reactions; Fluxes=fluxes; Equations=equations; Plots=plots; Names=crn.settings.simulation.plots |> List.map Functional2.to_string_plot |> List.toArray}

    let rec private matlab key expression =
        let render = matlab key
        let binary op a b = "(" + render a + op + render b + ")"
        match expression with
        | E.Key k -> key k
        | E.Float n -> number n
        | E.Plus xs -> if xs.IsEmpty then "0" else "(" + (xs |> List.map render |> String.concat "+") + ")"
        | E.Times xs -> if xs.IsEmpty then "1" else "(" + (xs |> List.map render |> String.concat ".*") + ")"
        | E.Minus x -> binary "-" x.sub1 x.sub2
        | E.Divide x -> binary "./" x.div1 x.div2
        | E.Power x -> binary ".^" x.base_ x.exponent
        | E.Absolute x -> "abs(" + render x + ")"
        | E.Log x -> "log(" + render x + ")"
        | E.Ceiling x -> "ceil(" + render x + ")"
        | E.Floor x -> "floor(" + render x + ")"
        | E.If (condition,a,b) -> "engine_if("+matlabBoolean key condition+","+render a+","+render b+")"
        | E.Modulo _ | E.Round _ -> render (portable expression)
    and private matlabBoolean key condition =
        let render=matlab key
        let boolean=matlabBoolean key
        let binary op a b="("+render a+op+render b+")"
        match condition with
        | E.BTrue -> "true" | E.BFalse -> "false"
        | E.BLT(a,b) -> binary "<" a b | E.BLeq(a,b) -> binary "<=" a b
        | E.BEq(a,b) -> binary "==" a b | E.BGeq(a,b) -> binary ">=" a b | E.BGT(a,b) -> binary ">" a b
        | E.BNot a -> "~("+boolean a+")"
        | E.BAnd(a,b) -> "("+boolean a+"&"+boolean b+")"
        | E.BOr(a,b) -> "("+boolean a+"|"+boolean b+")"

    let private matlabConditional = "function value = engine_if(condition,yes,no)\nif isscalar(condition)\n    if condition, value=yes; else, value=no; end\n    return;\nend\nvalue = no + zeros(size(condition));\nother = yes + zeros(size(condition));\nvalue(condition) = other(condition);\nend\n"

    let private matlabFile (system: System) =
        let index = system.Species |> Array.mapi (fun i sp -> sp,i+1) |> Map.ofArray
        let key vector = function Key.Species sp -> sprintf "x(%s%d)" (if vector then ":," else "") index.[sp] | Key.Time -> "t" | _ -> fail "Unresolved expression key."
        let sim = system.Crn.settings.simulation
        if sim.final <= sim.initial || sim.points < 1 || sim.points > 100000 then fail "MATLAB export requires an increasing time interval and 1–100000 output points."
        if sim.times |> List.exists (fun t -> not (Double.IsFinite t) || t < sim.initial || t > sim.final) then fail "Requested output times must lie within the integration interval."
        if sim.times |> List.pairwise |> List.exists (fun (a,b) -> b <= a) then fail "Requested output times must be strictly increasing."
        let ode = system.Crn.settings.deterministic
        if not (Double.IsFinite ode.reltolerance && Double.IsFinite ode.abstolerance) || ode.reltolerance <= 0.0 || ode.abstolerance <= 0.0 then fail "Solver tolerances must be finite and positive."
        let requested = if sim.times.IsEmpty then sprintf "linspace(%s,%s,%d)'" (number sim.initial) (number sim.final) (sim.points+1) else "[" + (sim.times |> List.map number |> String.concat ";") + "]"
        let lines = ResizeArray<string>()
        lines.Add "function sol = crn_export()"
        lines.Add "% Deterministic concentration equations; resolved parameters and initial populations."
        lines.Add ("% Time unit: " + system.Crn.settings.units.time.to_string + "; concentration unit: " + system.Crn.settings.units.concentration.to_string)
        lines.Add ("species = {" + (system.Species |> Array.map (fun sp -> quote sp.name) |> String.concat ",") + "};")
        lines.Add ("names = {" + (system.Names |> Array.map quote |> String.concat ",") + "};")
        lines.Add ("x0 = [" + (system.Initial |> Array.map number |> String.concat ";") + "];")
        lines.Add ("requested = " + requested + ";")
        lines.Add (sprintf "span = unique([%s;requested;%s]);" (number sim.initial) (number sim.final))
        lines.Add (sprintf "options = odeset('RelTol',%s,'AbsTol',%s);" (number ode.reltolerance) (number ode.abstolerance))
        // Include an interior sample to prevent two-endpoint solver output from becoming the requested grid.
        lines.Add (sprintf "span = unique([span;(%s+%s)/2]);" (number sim.initial) (number sim.final))
        lines.Add (sprintf "[ti,xi] = %s(@rhs,span,x0,options);" (if ode.stiff then "ode15s" else "ode45"))
        lines.Add "t = requested; x = interp1(ti,xi,t,'linear');"
        lines.Add (sprintf "plots = zeros(numel(t),%d);" system.Plots.Length)
        system.Plots |> Array.iteri (fun i expression -> lines.Add (sprintf "plots(:,%d) = %s;" (i+1) (matlab (key true) expression)))
        lines.Add "sol = struct('times',t,'populations',x,'species',{species},'plots',plots,'names',{names});"
        lines.Add "end"
        lines.Add "function dx = rhs(t,x)"
        lines.Add ("dx = [" + (system.Equations |> Array.map (matlab (key false)) |> String.concat ";") + "];")
        lines.Add "end"
        String.concat "\n" lines + "\n"+matlabConditional

    let private latexFile (system: System) =
        let key = function Key.Species sp -> "\\mathrm{" + tex sp.name + "}" | Key.Time -> "t" | _ -> fail "Unresolved expression key."
        let rec render expression =
            let binary op a b = "\\left(" + render a + op + render b + "\\right)"
            match expression with
            | E.Key k -> key k
            | E.Float n -> let text=number n in if text.IndexOfAny([|'E';'e'|])>=0 then let parts=text.Split([|'E';'e'|]) in parts.[0]+"\\times 10^{"+parts.[1]+"}" else text
            | E.Plus xs -> if xs.IsEmpty then "0" else xs |> List.map render |> String.concat "+"
            | E.Times xs -> if xs.IsEmpty then "1" else xs |> List.map (fun x -> "\\left("+render x+"\\right)") |> String.concat "\\," 
            | E.Minus x -> binary "-" x.sub1 x.sub2
            | E.Divide x -> "\\frac{"+render x.div1+"}{"+render x.div2+"}"
            | E.Power x -> "\\left("+render x.base_+"\\right)^{"+render x.exponent+"}"
            | E.Absolute x -> "\\left|"+render x+"\\right|"
            | E.Log x -> "\\ln\\left("+render x+"\\right)"
            | E.Ceiling x -> "\\left\\lceil "+render x+"\\right\\rceil"
            | E.Floor x -> "\\left\\lfloor "+render x+"\\right\\rfloor"
            | E.If (condition,a,b) -> "\\begin{cases}"+render a+" & "+boolean condition+"\\\\ "+render b+" & \\text{otherwise}\\end{cases}"
            | E.Modulo _ | E.Round _ -> render (portable expression)
        and boolean condition =
            let binary op a b=render a+op+render b
            match condition with
            | E.BTrue -> "\\text{true}" | E.BFalse -> "\\text{false}"
            | E.BLT(a,b) -> binary "<" a b | E.BLeq(a,b) -> binary "\\le " a b | E.BEq(a,b) -> binary "=" a b | E.BGeq(a,b) -> binary "\\ge " a b | E.BGT(a,b) -> binary ">" a b
            | E.BNot a -> "\\neg ("+boolean a+")"
            | E.BAnd(a,b) -> "("+boolean a+"\\land "+boolean b+")"
            | E.BOr(a,b) -> "("+boolean a+"\\lor "+boolean b+")"
        let equations = system.Species |> Array.mapi (fun i sp -> "\\frac{d "+key (Key.Species sp)+"}{dt} &= "+render system.Equations.[i])
        let initials = system.Species |> Array.mapi (fun i sp -> key (Key.Species sp)+"("+number system.Crn.settings.simulation.initial+") &= "+number system.Initial.[i])
        "% Deterministic concentration model; resolved parameters.\n% Time: "+system.Crn.settings.units.time.to_string+"; concentration: "+system.Crn.settings.units.concentration.to_string+"\n\\begin{align*}\n"+String.concat " \\\\\n" (Array.append equations initials)+"\n\\end{align*}\n"

    let private sbmlFile (system: System) =
        if system.Reactions |> List.exists(fun r -> r.reactants.IsEmpty && r.products.IsEmpty) then fail "SBML reactions require at least one reactant or product. Remove empty reactions before export."
        let ns = XNamespace.Get "http://www.sbml.org/sbml/level3/version2/core"
        let math = XNamespace.Get "http://www.w3.org/1998/Math/MathML"
        let attr name value = new System.Xml.Linq.XAttribute(XName.Get name, box value)
        let element name (attributes: XAttribute list) (children: XElement list) = XElement(ns+name, Array.ofList ((attributes |> List.map box) @ (children |> List.map box)))
        let me name (children: XElement list) = XElement(math+name,children |> List.map box)
        let value name (text: string) = XElement(math+name,text)
        let speciesIds = system.Species |> Array.mapi (fun i sp -> sp,"s"+string(i+1)) |> Map.ofArray
        let apply name children = me "apply" (me name [] :: children)
        let rec render expression =
            let unary name x = apply name [render x]
            match expression with
            | E.Key (Key.Species sp) -> value "ci" speciesIds.[sp]
            | E.Key Key.Time -> XElement(math+"csymbol",attr "encoding" "text",attr "definitionURL" "http://www.sbml.org/sbml/symbols/time","time")
            | E.Key _ -> fail "Unresolved SBML expression key."
            | E.Float n ->
                let text=number n
                if text.IndexOfAny([|'E';'e'|])>=0 then
                    let parts=text.Split([|'E';'e'|])
                    XElement(math+"cn",attr "type" "e-notation",parts.[0],me "sep" [],parts.[1])
                else value "cn" text
            | E.Plus xs -> if xs.IsEmpty then value "cn" "0" elif xs.Length=1 then render xs.Head else apply "plus" (List.map render xs)
            | E.Times xs -> if xs.IsEmpty then value "cn" "1" elif xs.Length=1 then render xs.Head else apply "times" (List.map render xs)
            | E.Minus x -> apply "minus" [render x.sub1;render x.sub2]
            | E.Divide x -> apply "divide" [render x.div1;render x.div2]
            | E.Power x -> apply "power" [render x.base_;render x.exponent]
            | E.Absolute x -> unary "abs" x
            | E.Log x -> unary "ln" x
            | E.Ceiling x -> unary "ceiling" x
            | E.Floor x -> unary "floor" x
            | E.If(condition,a,b) -> me "piecewise" [me "piece" [render a;boolean condition];me "otherwise" [render b]]
            | E.Modulo _ | E.Round _ -> render (portable expression)
        and boolean condition =
            let binary op a b=apply op [render a;render b]
            match condition with
            | E.BTrue -> me "true" [] | E.BFalse -> me "false" []
            | E.BLT(a,b) -> binary "lt" a b | E.BLeq(a,b) -> binary "leq" a b | E.BEq(a,b) -> binary "eq" a b | E.BGeq(a,b) -> binary "geq" a b | E.BGT(a,b) -> binary "gt" a b
            | E.BNot a -> apply "not" [boolean a]
            | E.BAnd(a,b) -> apply "and" [boolean a;boolean b]
            | E.BOr(a,b) -> apply "or" [boolean a;boolean b]
        let unitDefinition id kind exponent scale multiplier =
            element "unitDefinition" [attr "id" id] [element "listOfUnits" [] [element "unit" [attr "kind" kind;attr "exponent" exponent;attr "scale" scale;attr "multiplier" multiplier] []]]
        let (Time.Seconds seconds) = system.Crn.settings.units.time
        let (Concentration.Molar scale) = system.Crn.settings.units.concentration
        if not (Double.IsFinite seconds) || seconds<=0.0 then fail "The model time unit must be finite and positive."
        let units = element "listOfUnitDefinitions" [] [unitDefinition "model_time" "second" 1 0 seconds;unitDefinition "model_substance" "mole" 1 scale 1]
        let compartment = element "listOfCompartments" [] [element "compartment" [attr "id" "c";attr "spatialDimensions" 3;attr "size" 1;attr "units" "litre";attr "constant" "true"] []]
        let species = system.Species |> Array.mapi (fun i sp -> element "species" [attr "id" speciesIds.[sp];attr "name" sp.name;attr "compartment" "c";attr "initialConcentration" (number system.Initial.[i]);attr "substanceUnits" "model_substance";attr "hasOnlySubstanceUnits" "false";attr "boundaryCondition" (if system.Constants.[i] then "true" else "false");attr "constant" (if system.Constants.[i] then "true" else "false")] []) |> Array.toList |> element "listOfSpecies" []
        let reactions = system.Reactions |> List.mapi (fun i r ->
            let side name (entries: Mset.t<Species>) = entries |> List.map (fun entry -> element "speciesReference" [attr "species" speciesIds.[entry.element];attr "stoichiometry" entry.multiplicity;attr "constant" "true"] []) |> element name []
            let participants = [
                if not r.reactants.IsEmpty then yield side "listOfReactants" r.reactants
                if not r.products.IsEmpty then yield side "listOfProducts" r.products]
            // SBML kinetics specify amount/time; species identifiers evaluate to concentrations here.
            let kinetics = element "kineticLaw" [] [me "math" [apply "times" [value "ci" "c"; render system.Fluxes.[i]]]]
            let used = Set.union (r.reactants |> List.map (fun e -> e.element) |> Set.ofList) (r.products |> List.map (fun e -> e.element) |> Set.ofList)
            let modifiers = E.mentions system.Fluxes.[i] |> List.choose (function Key.Species sp when not(Set.contains sp used) -> Some sp | _ -> None) |> List.distinct
            let modifierList = if modifiers.IsEmpty then [] else [element "listOfModifiers" [] (modifiers |> List.map (fun sp -> element "modifierSpeciesReference" [attr "species" speciesIds.[sp]] []))]
            element "reaction" [attr "id" ("r"+string(i+1));attr "reversible" "false"] (participants @ modifierList @ [kinetics]))
        let contents = [units;compartment;species] @ (if reactions.IsEmpty then [] else [element "listOfReactions" [] reactions])
        let model = element "model" [attr "id" "crn_export";attr "name" (if String.IsNullOrWhiteSpace system.Crn.name then "Visual DSD model" else system.Crn.name);attr "timeUnits" "model_time";attr "substanceUnits" "model_substance";attr "extentUnits" "model_substance";attr "volumeUnits" "litre"] contents
        XDocument(XDeclaration("1.0","utf-8",null),[|box (element "sbml" [attr "level" 3;attr "version" 2] [model])|]).ToString() + "\n"

    let private svgFile (drawing: Svg.box) =
        let escape=Security.SecurityElement.Escape
        let rec group (g: Svg.group) =
            let content=match g.content with
                        | Svg.Paths paths -> paths |> List.map (fun p -> {p with path_label=p.path_label |> Option.map(fun label -> {label with label_text=escape label.label_text})}) |> Svg.Paths
                        | Svg.Raw raw -> Svg.Raw raw
            {g with name=escape g.name; content=content; sub_groups=List.map group g.sub_groups}
        {drawing with box_group=group drawing.box_group} |> Svg.to_string Crn.default_svg_style

    let private momentLatex (moments: Moments.t) =
        let indices=Collections.Generic.Dictionary<string,int>(StringComparer.Ordinal)
        let symbol name =
            let index=match indices.TryGetValue name with true,i -> i | _ -> let i=indices.Count+1 in indices.Add(name,i);i
            "\\mu_{"+string index+"}"
        let species=Moments.allSpecies moments
        let equations=Moments.combine_equations moments
        let left=equations |> List.map (fst >> Moments.toMonomial species >> symbol)
        let rec render expression =
            match expression with
            | MathNet.Symbolics.Expression.Number _ | MathNet.Symbolics.Expression.Approximation _ -> MathNet.Symbolics.LaTeX.format expression
            | MathNet.Symbolics.Expression.Identifier (Symbol name) -> symbol name
            | MathNet.Symbolics.Expression.Sum xs -> if xs.IsEmpty then "0" else xs |> List.map render |> String.concat "+"
            | MathNet.Symbolics.Expression.Product xs -> if xs.IsEmpty then "1" else xs |> List.map (fun x -> "\\left("+render x+"\\right)") |> String.concat "\\,"
            | MathNet.Symbolics.Expression.Power(a,b) -> "\\left("+render a+"\\right)^{"+render b+"}"
            | _ -> fail "The moment system contains an unsupported symbolic expression."
        let rows=List.map2 (fun name (_,expression) -> "\\frac{d"+name+"}{dt} &= "+render expression) left equations
        let legend=indices |> Seq.sortBy (fun entry -> entry.Value) |> Seq.map (fun entry -> "\\mu_{"+string entry.Value+"} &= \\text{"+tex entry.Key+"}") |> Seq.toList
        "% Moment equations; mu symbols are defined below.\n\\begin{align*}\n"+String.concat " \\\\\n" (rows@legend)+"\n\\end{align*}\n"

    let private closureMatlab (closure: Moments.t) =
        let species = Moments.allSpecies closure
        let names = closure.monomials |> List.map (Moments.toMonomial species) |> List.toArray
        let index = names |> Array.mapi (fun i name -> name, i+1) |> Map.ofArray
        let rec expression value =
            let render = expression
            match value with
            | MathNet.Symbolics.Expression.Number _ | MathNet.Symbolics.Expression.Approximation _ -> "("+MathNet.Symbolics.Infix.format value+")"
            | MathNet.Symbolics.Expression.Identifier (Symbol name) ->
                match Map.tryFind name index with Some i -> sprintf "x(%d)" i | None -> fail ("Unknown moment symbol: "+name)
            | MathNet.Symbolics.Expression.Sum xs -> if xs.IsEmpty then "0" else "("+(xs |> List.map render |> String.concat "+")+")"
            | MathNet.Symbolics.Expression.Product xs -> if xs.IsEmpty then "1" else "("+(xs |> List.map render |> String.concat ".*")+")"
            | MathNet.Symbolics.Expression.Power (a,b) -> "("+render a+".^"+render b+")"
            | _ -> fail "The moment closure contains an unsupported symbolic expression."
        let delta = closure.mc_settings.initial_minimum
        let initials = closure.monomials |> List.map (fun powers -> Array.fold2 (fun value power population -> value * (if population=0.0 then delta else population)**float power) 1.0 powers (closure.populations.index_to_species |> Array.map (fun p -> p.value)))
        let sim = closure.sim_settings
        if sim.final<=sim.initial || sim.points<1 || sim.points>100000 || not sim.times.IsEmpty then fail "Moment MATLAB requires an increasing interval, 1–100000 points and a uniform output grid."
        let equations = Moments.combine_equations closure |> List.map (snd >> expression)
        let plots = closure.mc_settings.plots |> List.mapi (fun i (plot,second) ->
            let render = matlab (fun j -> sprintf "x(:,%d)" (j+1)) plot
            [yield sprintf "plots(:,%d) = %s;" (i+1) render
             match second with
             | Some j -> yield sprintf "deviations(:,%d) = sqrt(max(0,x(:,%d)-plots(:,%d).^2));" (i+1) (j+1) (i+1)
             | None -> ()]) |> List.concat
        let ode=closure.ode_settings
        ["function sol = crn_export()"
         "% Moment closure; zero initial species use the model initial_minimum, matching the engine."
         sprintf "t = linspace(%s,%s,%d)';" (number sim.initial) (number sim.final) (sim.points+1)
         "names = {"+(names |> Array.map quote |> String.concat ",")+"};"
         "x0 = ["+(initials |> List.map number |> String.concat ";")+"];"
         sprintf "options = odeset('RelTol',%s,'AbsTol',%s);" (number ode.reltolerance) (number ode.abstolerance)
         sprintf "[ti,x] = %s(@rhs,t,x0,options);" (if ode.stiff then "ode15s" else "ode45")
         "x = interp1(ti,x,t,'linear');"
         sprintf "plots = zeros(numel(t),%d); deviations = NaN(numel(t),%d);" closure.mc_settings.plots.Length closure.mc_settings.plots.Length
         yield! plots
         "sol = struct('times',t,'populations',x,'species',{names},'plots',plots,'standardDeviation',deviations);"
         "end"
         "function dx = rhs(t,x)"
         sprintf "x = max(x,%s);" (number delta)
         "dx = ["+String.concat ";" equations+"];"
         "end"] |> String.concat "\n" |> fun text -> text+"\n"+matlabConditional

    let private sourceFile (crn: Crn) =
        // The original serializer omits moment settings and zero initial declarations.
        let mc=crn.settings.moment_closure
        let moments=sprintf "directive moments {order=%d;initial_minimum=%s;log_evaluation=%s;plots=[%s]}\n" mc.order (number mc.initial_minimum) (if mc.log_evaluation then "true" else "false") (mc.plots |> List.map Moment_closure_settings.to_string_monomial |> String.concat ";")
        moments+crn.to_string_zero_initials()

    let run (crn: Crn) =
        let instances = Exploration.instances crn
        if instances.Length > 32 then raise (ExecutionFailure("EXPORT_LIMIT", "Export supports at most 32 resolved runs per request. Select a smaller sweep."))
        let outputs = ResizeArray<ExportData>()
        let mutable bytes = 0
        for runIndex, instance in List.indexed instances do
            let configured = Exploration.configure crn instance
            let current = { configured with settings = { configured.settings with sweeps=[]; simulations=[]; simulation={ configured.settings.simulation with sweeps=[]; data=[] }; data=[] } }
            let prefix = sprintf "run-%03d" (runIndex+1)
            let add id name extension mime produce =
                let content, diagnostic =
                    try
                        let text = produce()
                        if String.IsNullOrWhiteSpace text then fail "The exporter produced no content."
                        if mime="image/svg+xml" && XDocument.Parse(text).Root.Name <> XNamespace.Get("http://www.w3.org/2000/svg")+"svg" then fail "The renderer did not produce an SVG document."
                        bytes <- bytes + Text.Encoding.UTF8.GetByteCount text
                        if bytes > 4*1024*1024 then raise (ExecutionFailure("EXPORT_LIMIT", "Exported files exceed 4 MiB. Reduce the network or batch."))
                        (if extension = ".m" then text.Replace("function sol = crn_export()", "function sol = "+(if id="closure-matlab" then "crn_closure_run_" else "crn_export_run_")+sprintf "%03d" (runIndex+1)+"()") else text), null
                    with
                    | ExecutionFailure("EXPORT_LIMIT",_) -> reraise()
                    | ExecutionFailure(code,message) -> null, Diagnostic(code,message)
                    | error -> null, Diagnostic("EXPORT_FAILED",error.Message)
                let fileName = if extension=".m" then (if id="closure-matlab" then "crn_closure_run_" else "crn_export_run_")+sprintf "%03d" (runIndex+1)+extension else prefix+"-"+id+extension
                outputs.Add(ExportData(id,name,fileName,mime,content,diagnostic,instance.name,instance.sweep,instance.assignment))
            let system = lazy (prepare current)
            add "code" "Resolved CRN" ".crn" "text/plain" (fun () -> sourceFile current)
            add "sbml" "SBML Level 3 Version 2" ".xml" "application/sbml+xml" (fun () -> sbmlFile system.Value)
            add "matlab" "MATLAB / Octave ODE" ".m" "text/plain" (fun () -> matlabFile system.Value)
            add "equations" "ODE equations (LaTeX)" ".tex" "application/x-tex" (fun () -> latexFile system.Value)
            let drawing = lazy (current.create_blank_attributes())
            add "initials" "Initial populations (SVG)" ".svg" "image/svg+xml" (fun () ->
                let env=Parameters.to_env current.settings.parameters
                let eval=E.eval (Environment.find env)
                if current.initials |> List.exists (fun i -> i.time |> Option.exists (fun t -> eval t <> current.settings.simulation.initial)) then fail "Initial population SVG does not encode scheduled input times. Use resolved CRN code for the complete schedule."
                let model={drawing.Value with initials=drawing.Value.initials |> List.map(fun i -> {i with value=E.Float(eval i.value)})}
                Crn.initials_to_svg model |> svgFile)
            add "reactions" "Reaction scheme (SVG)" ".svg" "image/svg+xml" (fun () -> Crn.reactions_to_svg drawing.Value |> svgFile)
            if current.settings.simulator = Simulator.MC then
                let moments = lazy (
                    let system = system.Value
                    let mc = current.settings.moment_closure
                    if system.Constants |> Array.exists id then fail "Moment exports do not support constant species."
                    if current.settings.stochastic.scale <> 1.0 then fail "Moment exports require stochastic scale=1."
                    if not(Double.IsFinite mc.initial_minimum) || mc.initial_minimum<=0.0 then fail "Moment closure initial_minimum must be finite and positive."
                    if current.reactions |> List.exists (fun r -> match r.rate,r.reverse with Rate.Function _,_ | _,Some(Rate.Function _) -> true | _ -> false) then fail "Moment exports require mass-action rates."
                    let count = Moment_closure_settings.initAllOrders system.Species.Length mc.order
                    if count.Length > 256 then fail "Moment exports support at most 256 moments."
                    Moments.generateMoments current)
                let closure = lazy (Moments.generateClosure moments.Value)
                add "moments" "Moment equations (LaTeX)" ".tex" "application/x-tex" (fun () -> momentLatex moments.Value)
                add "closure" "Moment closure equations (LaTeX)" ".tex" "application/x-tex" (fun () -> momentLatex closure.Value)
                add "closure-matlab" "Moment closure MATLAB / Octave" ".m" "text/plain" (fun () -> closureMatlab closure.Value)
        outputs.ToArray()
