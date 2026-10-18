// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module Microsoft.Research.Biology.StabilityZ3.Solver

module Encoding = Microsoft.Research.Biology.StabilityZ3.Encoding
open TuringSymbolic

open Microsoft.Research.CRNEngine.Expression
open Microsoft.Research.CRNEngine.Rng
open Microsoft.Research.Biology.StabilityZ3

//type Result = SAT | UNSAT | UNKNOWN | FAILED
//    with static member from_string str =
//          match str with
//          | "SAT" -> SAT
//          | "UNSAT" -> UNSAT
//          | "UNKNOWN" -> UNKNOWN
//          | "FAILED" -> FAILED
//          | s -> failwithf "Unknown result type: %s" s
let string_of_status status = 
    match status with 
    | Microsoft.Z3.Status.SATISFIABLE -> "SAT"
    | Microsoft.Z3.Status.UNKNOWN -> "UNKNOWN"
    | Microsoft.Z3.Status.UNSATISFIABLE -> "UNSAT"
    | _ -> failwithf "Unknown Z3 status %A" status

type solverType = 
    | Standard   //Vanilla Z3 solver
    | Nlsat
    | NlsatTO of uint32
    | Custom
    | CustomTO of uint32
    | CustomA of Microsoft.Z3.Context*Microsoft.Z3.Solver
    | Simple
    | Qfnra
    | QfnraTO of uint32
    | PortfolioNoCustom
    | PortfolioNoCustomTO of uint32
    | Portfolio
    | PortfolioTO of uint32  //Timeout for the protfolio tactic only
    | PortfolioTO2 of uint32 //Timouts for the portfolio tactic and each sub-tactic
    | PortfolioTO3 of uint32 //Timout for each portfolio sub-tactic (no timout for the outer portfolio tactic)
    | Smt
    | SmtTO of uint32

    static member MkDefaultSolver t = PortfolioTO t

    static member to_string (s:solverType) = 
        match s with
        | Standard        -> "standard"
        | Nlsat           -> "nlsat"
        | NlsatTO t       -> sprintf "nlsat:%u" t
        //| Custom
        //| CustomTO of uint32
        //| CustomA of Microsoft.Z3.Context*Microsoft.Z3.Solver
        | Simple          -> "simple"
        | Qfnra           -> "qfnra"
        | QfnraTO t       -> sprintf "qfnra:%u" t
        | PortfolioNoCustom -> sprintf "portfolioNoCustom"
        | PortfolioNoCustomTO t -> sprintf "portfolioNoCustom:%u" t
        | Portfolio       -> "portfolio"
        | PortfolioTO t   -> sprintf "portfolio:%u" t
        | PortfolioTO2 t  -> sprintf "portfolio2:%u" t
        | PortfolioTO3 t  -> sprintf "portfolio3:%u" t
        | Smt             -> "smt"
        | SmtTO t         -> sprintf "smt:%u" t
        | _               -> failwithf "Serialization of solver %A not supported" s

    static member from_string (s:string) = 
        let solverStr, t = 
            if s.Contains(":") then 
                let i = s.IndexOf(':')
                s.[0..i-1], Some (uint32 s.[i+1..])
            else
                s, None                            
        match t, solverStr with
        | None  ,  "standard"                    -> Standard         
        | None  ,  "nlsat"                       -> Nlsat            
        | Some  t, "nlsat"                       -> NlsatTO t        
        | None  ,  "simple"                      -> Simple           
        | None  ,  "qfnra"                       -> Qfnra            
        | Some t,  "qfnra"                       -> QfnraTO t
        | Some t,  "portfolioNoCustom"           -> PortfolioNoCustomTO t
        | None  ,  "portfolio"                   -> Portfolio        
        | Some t,  "portfolio"                   -> PortfolioTO t    
        | Some t,  "portfolio2"                  -> PortfolioTO2 t   
        | Some t,  "portfolio3"                  -> PortfolioTO3 t   
        | None  ,  "smt"                         -> Smt              
        | Some t,  "smt"                         -> SmtTO t       
        | _ -> failwithf "Deserialization of solver %s (%s,%A) not supported" s solverStr t



let GetZ3Value (e:Microsoft.Z3.Expr)= 
    match e with
    | :? Microsoft.Z3.RatNum as number -> number.Double
    | :? Microsoft.Z3.AlgebraicNum as number -> number.ToLower(30u).Double
    | _ -> failwithf "Expected a real algebraic model value, received %O" e


let CheckDefault (e:BoolExpr) =             
    let z3 = new Microsoft.Z3.Context()
    let solver = z3.MkTactic("qfnra-nlsat").Solver
    //let qfnra = z3.MkTactic("qfnra-nlsat")
    //let split = z3.ParAndThen(z3.MkTactic("split-clause"), qfnra)            
    //let solver = split.Solver

    let t = System.DateTime.Now    

    let encoded, variables = e |> Encoding.BoolExpr2Real z3        

    let tenc =  (System.DateTime.Now - t).TotalSeconds    

    let t = System.DateTime.Now    
    solver.Assert(encoded)    
    let status = solver.Check()    
    let tsol =  (System.DateTime.Now - t).TotalSeconds    

    let result = 
        if status = Microsoft.Z3.Status.SATISFIABLE  then 
            let model = solver.Model
            let values = variables |> Map.map(fun v var -> model.Eval(var,true) |> GetZ3Value)            
            Some values         
        else None
    
    printfn "\nDone:\t\t%A" status
    printfn "\nEncoding time:\t%s seconds" (tenc.ToString())
    printfn "\nSolving  time:\t%s seconds" (tsol.ToString())
    z3.Dispose()
    result
    
let CheckNoPrint (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (variables:Map<string,Microsoft.Z3.ArithExpr>) csts =
    //Microsoft.Z3.Global.SetParameter("verbose","1000")    
    solver.Assert(csts)
    let smt = solver.ToString()    

    let realSort = z3.MkRealSort()
    let t0 = System.DateTime.Now          
    try
        let status = solver.Check()            
        let dt = (System.DateTime.Now - t0).TotalSeconds
        let info = {time = dt; smt = smt}
        match status with 
        | Microsoft.Z3.Status.SATISFIABLE ->
            let model = solver.Model
            if not (model.Eval(z3.MkAnd(csts),true).IsTrue) then failwith "The solver model does not satisfy its asserted constraints."
            let values = 
                variables 
                |> Map.map(fun _ var ->  //return the Z3 variable as well (e.g. for uniqueness)?                    
                    model.Eval(var,true) ////let v = model.Eval(var,true) TODO: this returns 0.0s                    
                    |> GetZ3Value
                    )
            //values |> Map.iter (fun var v -> printfn "%s = %s" var (v.ToString()))                
            SAT(values, info)
        | Microsoft.Z3.Status.UNKNOWN -> UNKNOWN info
        | Microsoft.Z3.Status.UNSATISFIABLE -> UNSAT info
        | _ -> failwithf "Unknown Z3 status %A" status
    with
    | e -> 
        let dt = (System.DateTime.Now - t0).TotalSeconds
        let info = {time = dt; smt = smt}
        FAILED(e.Message, info)
    

//let Check (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (variables:Map<string,Microsoft.Z3.ArithExpr>) csts =
//    let result, status = CheckNoPrint (z3,solver) variables csts
//    printfn "\nDone (%A)" status
//    result, status=Microsoft.Z3.Status.UNKNOWN



let Enumerate (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (variables:Map<string,Microsoft.Z3.ArithExpr>) csts =           
  solver.Assert(csts)
  let mutable status = solver.Check()
  let mutable k = 0
  let eq = 
    [|
      while status = Microsoft.Z3.Status.SATISFIABLE do          
        let model = solver.Model
        let values = variables |> Map.map(fun v var -> model.Eval(var,true))
        yield values   
                
        printfn "\nSolution %d:\n" k
        values
        |> Map.toArray
        |> Array.map (fun (var, v) ->           
          printfn "\t%s = %s" var (v.ToString())
          z3.MkEq(variables.[var], v)
          )
        |> z3.MkAnd
        |> z3.MkNot
        |> fun x -> solver.Assert(x)     
        
        k <- k + 1
        status <- solver.Check()
      |]

  printfn "\nDone (%A)" status
  eq


//let EncodeAndCheck  (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (expr:BoolExpr) =           
//    let t = System.DateTime.Now
//    printf "Encoding..."
//    let expr, vars = expr |> Encoding.BoolExpr2Real z3
//    printfn "done (%f sec)" ((System.DateTime.Now-t).TotalSeconds)

//    printf "Checking..."    
//    Check (z3, solver) vars [|expr|]


//let EncodeAndCheckWithVars  (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (vars:Set<string>) (expr:BoolExpr) =           
//    let t = System.DateTime.Now
//    printf "Encoding..."
//    let expr, vars = Encoding.BoolExpr2RealWithVars z3 vars expr
//    printfn "done (%f sec)" ((System.DateTime.Now-t).TotalSeconds)

//    printf "Checking..."    
//    Check (z3, solver) vars [|expr|]

let EncodeAndEnumerate  (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (expr:BoolExpr) =           
    let expr, vars = expr|> Encoding.BoolExpr2Real z3    
    Enumerate (z3, solver) vars [|expr|]
  
//let ExportSMTLIB simplify (z3:Microsoft.Z3.Context) filename (expr:BoolExpr) =           
//  let problem, vars = expr|> Encoding.BoolExpr2Real z3  
 
//  let problem' = 
//    if simplify then 
//        problem.Simplify() :?> Microsoft.Z3.BoolExpr
//    else
//        problem
  
//  //let smt =  z3.BenchmarkToSMTString("","","","",[||], problem').[2..].Replace("(set-info :status )\n", "").Replace("+zero", "0")
//  let smt = problem'.ToString()
//  System.IO.File.WriteAllText(sprintf "%s.smt2" filename ,smt)
  
  //(check-sat-using (then simplify solve-eqs smt)) 



//let EncodeAndPrintCore  (z3:Microsoft.Z3.Context, solver:Microsoft.Z3.Solver) (expr:BoolExpr) =           
//    //Microsoft.Z3.Global.SetParameter("unsat_core","true")
//    //Microsoft.Z3.Global.SetParameter("verbose","1000")

//    let t = System.DateTime.Now
//    printf "Encoding..."      

//    let expr, vars = expr |> Encoding.BoolExpr2Real z3
//    let e = Check (z3, solver) vars [|expr|]

//    printfn "done (%f sec)" ((System.DateTime.Now-t).TotalSeconds)
//    solver.UnsatCore
//    |> Array.iter(fun e -> printfn "\n%s\n" (e.ToString()))



//Custom tactic 0: Works on Alpha with free params!
//NOTE: NEEDS TO BE CLEANED UP!

let CustomTactic1 timeout (z3:Microsoft.Z3.Context) = 
    let prop1 = z3.Repeat(z3.MkTactic("propagate-values"))
    let prop2 = z3.Repeat(z3.MkTactic("propagate-ineqs"))
    let simplify = z3.Repeat(z3.MkTactic("simplify"))
    let prop = z3.Then(prop1, prop2)
    let sandp = z3.Then(z3.Then(z3.Then(simplify, prop), simplify), z3.MkTactic("factor"))
    let split = z3.ParAndThen(z3.MkTactic("split-clause"), sandp)    
    let split2 = z3.Then(sandp, split)  
    let qfnra = 
        match timeout with
            | Some t -> z3.TryFor(z3.MkTactic("qfnra-nlsat"), t)
            | None -> z3.MkTactic("qfnra-nlsat")
    z3.ParAndThen(split2,qfnra)  
  

let CustomTactic2 timeout (z3:Microsoft.Z3.Context) = 
  let qfnra = 
    match timeout with
    | Some t -> z3.TryFor(z3.MkTactic("qfnra-nlsat"), t)
    | None -> z3.MkTactic("qfnra-nlsat")
  z3.ParAndThen(z3.MkTactic("split-clause"),qfnra)  


let PortfolioNoCustomTactic (timeout:uint32 option) (seed:int option) (z3:Microsoft.Z3.Context) = 
    let rnd = match seed with None -> None | Some seed -> new Random(seed) |> Some
    let next_seed() = match rnd with None -> None | Some rnd -> rnd.Next() |> uint32 |> Some

    let MkTactic tc = 
        match timeout with
        | Some t -> z3.TryFor(tc,t)
        | None -> tc

    let MkParam (s:string) (pv:(string*bool) seq) = 
        let p = z3.MkParams()
        let p = pv |> Seq.fold (fun (acc:Microsoft.Z3.Params) -> acc.Add) p
        match next_seed() with Some seed -> p.Add(s,seed) | None -> p
    
    //let seed_nlsat = 
    //    Array.init 10 (fun i -> 
    //        let p = z3.MkParams()
    //        p.Add("seed",(uint32) i)
    //        p.Add("elim_root_objects", false)
    //        //p.Add("algebraic_number_evaluator",false)
    //        //p.Add("factor", false)
    //        z3.UsingParams(z3.MkTactic("qfnra-nlsat"),p)
    //    )
            
    let qfnra1 = 
        let p = MkParam "seed" ["eq2ineq", true]
        z3.UsingParams(z3.MkTactic("qfnra-nlsat"),p) |> MkTactic
        
    let seeded options =
        z3.UsingParams(z3.MkTactic "qfnra-nlsat", MkParam "seed" options) |> MkTactic
    [| qfnra1
       seeded []
       seeded ["randomize",false]
       seeded ["factor",false]
       z3.MkTactic("default") |> MkTactic
       z3.UsingParams(z3.MkTactic("smt"), MkParam "random_seed" []) |> MkTactic |]

let PortfolioTactic timeout seed (z3:Microsoft.Z3.Context) = 
    PortfolioNoCustomTactic timeout seed z3
    (*let p = z3.MkParams()
    p.Add("seed", (uint32)1) |> ignore
    let ct = z3.UsingParams(CustomTactic1 timeout z3, p)
    [| ct
    //;  CustomTactic2 timeout z3
    //;  z3.MkTactic("qfnra") |> MkTactic
    //;  z3.MkTactic("nlsat") |> MkTactic
    |]                   
    //|> Array.append seed_nlsat
    |> Array.append (PortfolioNoCustomTactic timeout z3)*)
    

let MkSolverSeed seed st = 
    let z3 = 
        match st with
        | CustomA(z3,_) -> z3
        | _ -> new Microsoft.Z3.Context() 

    let solver = 
        match st with      
          | Standard -> z3.MkSolver()  
          | Nlsat ->
            let t = z3.MkTactic("qfnra-nlsat")
            match seed with None -> t.Solver
                          | Some seed ->
                            let p = z3.MkParams()
                            let p = p.Add("seed",uint32(seed))
                            let t = z3.UsingParams(t,p)
                            t.Solver
          | NlsatTO timeout ->
            let tactic = z3.MkTactic("qfnra-nlsat")
            let tactic = match seed with None -> tactic | Some seed -> z3.UsingParams(tactic, z3.MkParams().Add("seed", uint32 seed))
            z3.TryFor(tactic, timeout).Solver
          | Qfnra     -> z3.MkTactic("qfnra").Solver
          | QfnraTO t -> z3.TryFor(z3.MkTactic("qfnra"), t).Solver
          | Custom -> (CustomTactic1 None z3).Solver
          | CustomTO t -> (CustomTactic1 (Some t) z3).Solver
          | CustomA (_, s) -> s
          | Simple -> z3.MkSimpleSolver()
          | PortfolioNoCustom -> z3.ParOr(PortfolioNoCustomTactic None seed z3).Solver
          | PortfolioNoCustomTO t -> z3.TryFor(z3.ParOr(PortfolioNoCustomTactic None seed z3), t).Solver
          | Portfolio -> z3.ParOr(PortfolioTactic None seed z3).Solver
          | PortfolioTO t -> z3.TryFor(z3.ParOr(PortfolioTactic None seed z3), t).Solver                  
          | PortfolioTO2 t -> z3.TryFor(z3.ParOr(PortfolioTactic (Some t) seed z3), t).Solver                  
          | PortfolioTO3 t -> z3.ParOr(PortfolioTactic (Some t) seed z3).Solver                          
          //| PortfolioTO3 t -> 
          //   let portfolio = z3.TryFor(z3.ParOr(PortfolioTactic (Some t) z3), t)
          //   let nlsat = z3.TryFor(z3.MkTactic("qfnra-nlsat"), t)
          //   let basic = z3.TryFor(z3.MkTactic("default"), t)
             
          | Smt   -> z3.MkTactic("smt").Solver
          | SmtTO t -> z3.TryFor(z3.MkTactic("smt"), t).Solver
    z3, solver

let MkSolver st = MkSolverSeed None st

//module Encoding = Microsoft.Research.Biology.TuringZ3.Encoding
//module TuringSymbolic = Microsoft.Research.Biology.TuringZ3.TuringSymbolic

let CheckEquilibrium direct_to_z3 solver_type (S:Dynamical) = 

  let z3, solver = MkSolver solver_type
  
  let expr, vars = 
    if direct_to_z3 then
        //let tc = System.DateTime.Now        
        //if opt.print_status then System.Console.Error.Write("Generating constraints to Z3...")  
        let vars = 
            S.GetVars        
            |> Set.toArray                        
            |> Array.map(fun v -> 
                let v' = z3.MkRealConst(v) :> Microsoft.Z3.ArithExpr
                v, v')
            |> Map.ofArray
        let expr = S.EqCst |> Array.map (Encoding.BoolExpr2RealRec vars z3)
        //if opt.print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
        z3.MkAnd expr, vars
    else
        let tc = System.DateTime.Now        
        //if opt.print_status then System.Console.Error.Write("Generating constraints...")
        //let expr, vars = TuringSymbolic.Turing opt S
        let vars = Array.map ExpressionFunctions.BGetVars S.EqCst |> Set.unionMany
        let expr = S.EqCst |> Array.reduce (fun e1 e2 -> BAnd (e1,e2))
        //if opt.print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
  
        let tc = System.DateTime.Now        
        //if opt.print_status then System.Console.Error.Write("Encoding to Z3...")
        let expr, vars = Encoding.BoolExpr2RealWithVars z3 vars expr
        //if opt.print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
        expr, vars
  
  //if opt.print_status then System.Console.Error.WriteLine("Checking Turing...")  
  let result = CheckNoPrint (z3,solver) vars [|expr|]
    (*if opt.print_status 
    then 
        let result, status = Check (z3, solver) vars [|expr|]
        let total_time = (System.DateTime.Now - t).TotalSeconds
        printfn "Time:\t%.1f sec" total_time  
        result, status, total_time
    else *)        
  z3.Dispose()   
  {S with solution = result}


//TODO: fix implementation
//let EnumerateEquilibria direct_to_z3 solver_type (max_solutions:int option) (S:Dynamical) = 
//  let z3, solver = MkSolver solver_type  
//  let expr, vars = 
//    if direct_to_z3 then                
//        let vars = 
//            S.GetVars        
//            |> Set.toArray                        
//            |> Array.map(fun v -> 
//                let v' = z3.MkRealConst(v) :> Microsoft.Z3.ArithExpr
//                v, v')
//            |> Map.ofArray
//        let expr = S.EqCst |> Encoding.BoolExpr2RealRec vars z3        
//        expr, vars
//    else           
//        let expr = S.EqCst
//        let vars = ExpressionFunctions.BGetVars expr                
//        Encoding.BoolExpr2RealWithVars z3 vars expr                  
  
  

//  let mutable finished = false
//  let mutable cnt = 0  
//  let results = 
//      [ while not finished do       
//            let result = CheckNoPrint (z3,solver) vars [| expr |]                    

//            match result with 
//            | Some R -> 
//                yield (R |> Map.map(fun _ (_,v) -> v), is_unknown)
//                if (max_solutions.IsSome && cnt > max_solutions.Value) then                                 
//                    finished <- true
//                else                
//                    let unique = 
//                        result.Value
//                        |> Map.toArray
//                        |> Array.map(fun (key,(z3value,_)) -> z3.MkEq(vars.[key],z3value))
//                        |> z3.MkAnd
//                        |> z3.MkNot
//                    solver.Assert(unique)
//                    cnt <- cnt + 1                
//            | None -> 
//                finished <- true
//                yield (Map.empty, is_unknown)
//      ]  
//  z3.Dispose()
//  results




let CheckTuring direct_to_z3 solver_type (opt:TuringAnalysisSettings) (sys:Dynamical) =
  if opt.model_reduction <> ModelReduction.Off then
      invalidArg "model_reduction" "Python-based equilibrium model reduction is not available in the standalone application."
  let z3, solver = MkSolverSeed opt.seed solver_type
  use ownedContext = z3
  let expr, vars =
    if direct_to_z3 then
        let constraints, vars = TuringSymbolic.TuringZ3 opt z3 sys
        z3.MkAnd constraints, vars
    else
        let constraints, vars = TuringSymbolic.Turing opt sys
        let expression = Array.reduce (fun e1 e2 -> BAnd (e1,e2)) constraints
        Encoding.BoolExpr2RealWithVars z3 vars expression
  {sys with solution = CheckNoPrint (z3,solver) vars [|expr|]}

let CheckBistability direct_to_z3 solver_type print_status (seed:int option) (S:Dynamical) =   
    let z3, solver = MkSolverSeed seed solver_type
    use ownedContext = z3
  
    let expr, vars = 
        if direct_to_z3 then
            let tc = System.DateTime.Now        
            if print_status then System.Console.Error.Write("Generating constraints to Z3...")  
            let expr, vars = Multistability.BistableZ3 z3 S
            if print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
            z3.MkAnd expr, vars
        else
            let tc = System.DateTime.Now        
            if print_status then System.Console.Error.Write("Generating constraints...")
            let constraints, vars = Multistability.Bistable S
            let expr = Array.reduce (fun e1 e2 -> BAnd (e1,e2)) constraints
            if print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
  
            let tc = System.DateTime.Now        
            if print_status then System.Console.Error.Write("Encoding to Z3...")
            let expr, vars = Encoding.BoolExpr2RealWithVars z3 vars expr  
            if print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
            expr, vars

    if print_status then System.Console.Error.WriteLine("Checking bistability...")
    let result = CheckNoPrint (z3, solver) vars [|expr|]
    ()      
    if print_status then printfn "Time:\t%.1f sec" result.Time    
    {S with solution = result}
  
let EnumerateTuring direct_to_z3 solver_type (opt:TuringAnalysisSettings) unique_fn (S:Dynamical) =      
    //printfn "WARNING: EXPERIMENTAL FUNCTIONALITY"
    let z3, sol = MkSolver solver_type    
    let expr, vars = 
        if direct_to_z3 
        then 
            let tc = System.DateTime.Now        
            if opt.print_status then System.Console.Error.Write("Generating constraints to Z3...")  
            let expr, vars = TuringZ3 opt z3 S
            if opt.print_status then System.Console.Error.WriteLine("done ({0} sec)", (System.DateTime.Now - tc).TotalSeconds)
            expr, vars
        else failwith "Intermediate encoding not currently implemented for enumeration"
    sol.Assert expr

    if opt.print_status then System.Console.Error.WriteLine("Enumerating Turing...")
    let rec generateNewSolution id solutions = 
        let t = System.DateTime.Now    
        let status = sol.Check()
        let t'= (System.DateTime.Now - t).TotalSeconds
        if status = Microsoft.Z3.Status.SATISFIABLE
        then
            System.Console.Error.WriteLine("{0}:\t{1}", id, t')
            //let evaluated = vars |> Map.map (fun v var -> sol.Model.Eval(var,true))    // TODO: This line creates a new variable!
            let evaluated = vars |> Map.map (fun _ var -> sol.Model.Eval(z3.MkConst(var.FuncDecl.Name, z3.MkRealSort()),true))
            let values = evaluated |> Map.map (fun _ -> GetZ3Value)
            (*let topology = 
                values 
                |> Map.toList 
                |> List.filter (fun (k,v) -> k.StartsWith("c"))
                |> List.map (fun (k,v) -> sprintf "%s = %d" k (int v))
                |> String.concat "; "
            System.Console.Error.WriteLine("{0}", topology)*)
            
            //assert uniqueness constraint        
            values 
            |> Map.map (fun _ v -> Float v) 
            |> unique_fn
            |> Encoding.BoolExpr2RealRec vars z3 
            |> fun x -> sol.Assert(x)
        
            let new_solutions = (id, { S with solution = SAT(values, {smt=""; time = t'})}) :: solutions
            generateNewSolution (id+1) new_solutions
        else status, solutions

    let status, solutions = generateNewSolution 0 []
    if opt.print_status then System.Console.Error.WriteLine("Finished returning {0}", string_of_status status)    
    
    List.rev solutions

//let RunSet criterion callback (systems:Dynamical[]) = 
//    let numsubs = systems.Length    
//    systems
//    |> Array.iteri (fun i system -> 
//        // Print the problem information before attempting to solve
//        printf "ID %d of %d | %s " i numsubs system.name            
//        let result = criterion system                      
//        callback system result        
//    )
    
  (*
  //Custom tactic 1
  let purify = "purify-arith" |> z3.MkTactic |> z3.Repeat
  let simplify = "simplify" |> z3.MkTactic |> z3.Repeat
  let solve = "solve-eqs" |> z3.MkTactic |> z3.Repeat
  let simplify2 = "ctx-simplify" |> z3.MkTactic |> z3.Repeat
  let simplify3 = "ctx-solver-simplify" |> z3.MkTactic |> z3.Repeat
  let simplifyAll = z3.Then(simplify, simplify2, [|simplify3|]) |> z3.Repeat
  let qfnra = "qfnra-nlsat" |> z3.MkTactic |> z3.Repeat
  let purify = "purify-arith" |> z3.MkTactic |> z3.Repeat
  let simplify = "simplify" |> z3.MkTactic |> z3.Repeat
  let nla2bv = "nla2bv" |> z3.MkTactic |> z3.Repeat
  let smt   = "smt" |> z3.MkTactic |> z3.Repeat    
  let nlsat = "nlsat" |> z3.MkTactic |> z3.Repeat
  let qfnra = "qfnra-nlsat" |> z3.MkTactic |> z3.Repeat


    //z3.Repeat (z3.Then(purify, simplify, [|simplify2; simplify3; nlsat; qfnra|]))
  let tactic = z3.Repeat (z3.Then(purify, simplify, [|simplify2; simplify3; nlsat; qfnra|]))
    //z3.Then(z3.Repeat(z3.MkTactic("purify-arith")),z3.MkTactic("nlsat"))
    //z3.Repeat (z3.Then(purify, simplify, [|nlsat; nlsat; qfnra|]))
  let solver = tactic.Solver
  *)

  (*
  //Custom tactic 2
  
  let purifyAndSimplify = z3.Then(purify, simplifyAll) |> z3.Repeat
  let solveAndSimplify = z3.Then(solve, purifyAndSimplify) |> z3.Repeat


  let tactic = z3.Repeat (z3.Then(purifyAndSimplify, solveAndSimplify, [|qfnra|]))  
  let solver = tactic.Solver
  *)

  (*
  //Custom tactic 3 : Unknown
  
  let solver = z3.Then(purify, simplify, [|nla2bv; smt|]).Solver
  *)
  
//  let pars = z3.MkParams()
//  pars.Add("expand_power", true)
//  solver.Parameters <- pars
  
  //printfn "%A" (solver.Help.Replace("\n","\n\n\n"))  


(*
let MkSolver bounds variables csts = 
  // Assert the properties and solve  
        
  let problem = MkProblem bounds variables csts

  

  (*
  let pars = z3.MkParams()
  pars.Add("expand_power", true)
  let problem' = problem.Simplify(pars) :?> BoolExpr  
  solver.Assert(problem')   
  *)

  solver.Assert(problem)   
  solver
*)
