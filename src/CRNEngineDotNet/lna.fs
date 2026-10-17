// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.Research.CRNEngine
open System open Oslo
[<JavaScript>] 
type Lna = 
  { 
    ode: OdeOslo;
    outputconcentrations: bool;
    initials: float array;
    stoich: float [][];
    covariance: Oslo.Matrix;
    times: float list;
    nextprinttime: float;
    jacobian: Oslo.Vector -> Oslo.Matrix;
    drift: Oslo.Vector -> Oslo.Matrix;
    props: float -> Oslo.Vector -> Oslo.Vector;
    stepsdone: int;
    scale: float;
  }
  static member default_scale = 1.0 
  (* TODO move into OSLO *)
  static member private CrossProduct (a:Oslo.Vector) (b:Oslo.Vector) =
    let m = Vector.length a
    let n = Vector.length b
    let r = Matrix.zeros m n
    for i in 0..(m-1) do
        for j in 0..(n-1) do
            r.[i, j] <- a.[i] * b.[j]
    r    
  static member private OsloTranspose (m:Oslo.Matrix) =
    let cols = Matrix.numCols m
    let rows = Matrix.numRows m
    let result = Oslo.Matrix.zeros cols rows
    for i in 0..rows - 1 do
        for j in 0..cols - 1 do
            result.[j].[i] <- m.[i].[j]
    result
  static member private EuclideanNorm vec = 
    vec
    |> Seq.sumBy (fun x -> x * x)
    |> Math.Sqrt
  (* End TODO *)
  // Affine observables use the full covariance, including cross-species terms.
  static member affine_plot (values:float[]) time (plot:Expression.t<Inlined<int>>) =
    let zero () = Array.zeroCreate values.Length
    let constant c = c, zero()
    let varying (_, gradient:float[]) = gradient |> Array.exists ((<>) 0.0)
    let scale factor (value, gradient:float[]) = value * factor, gradient |> Array.map ((*) factor)
    let add (a, da:float[]) (b, db:float[]) = a + b, Array.map2 (+) da db
    let rec read expression =
      match expression with
      | Expression.Float n -> constant n
      | Expression.Key Inlined.Time -> constant time
      | Expression.Key (Inlined.Species i) -> let d = zero() in d.[i] <- 1.0; values.[i], d
      | Expression.Plus terms -> terms |> List.map read |> List.fold add (constant 0.0)
      | Expression.Minus e -> add (read e.sub1) (scale -1.0 (read e.sub2))
      | Expression.Times terms -> terms |> List.map read |> List.fold (fun a b ->
          if varying a && varying b then failwith "LNA plots must be affine in species populations."
          if varying a then scale (fst b) a else scale (fst a) b) (constant 1.0)
      | Expression.Divide e ->
          let denominator = read e.div2
          if varying denominator then failwith "LNA plots must be affine in species populations."
          scale (1.0 / fst denominator) (read e.div1)
      | Expression.Power e when e.exponent = Expression.Float 1.0 -> read e.base_
      | other ->
          if Expression.mentions other |> List.exists (function Inlined.Species _ -> true | _ -> false) then
            failwith "LNA plots must be affine in species populations."
          constant (Expression.eval (function Inlined.Time -> time | Inlined.Species i -> values.[i]) other)
    read plot
  static member initialise (ode:OdeOslo) (matrix:float[][]) (initials:float array) lna_scale =     
    let num_species = Array.length matrix
    let num_reactions = Array.length matrix.[0]
    let get_k : (Rate<float,Lambda<Inlined<int>>> -> float) = 
      function
      | Rate.MassAction r -> r
      | Rate.Function _ -> failwith "Functional rates not yet implemented"    
    let dFdx (pops : Vector) = 
      ode.rateDs 
      |> Array.mapi (fun i rate -> 
          [| 0..num_species - 1 |] 
          |> Array.map (fun j -> 
              if ode.powers.[i] |> List.exists (fun (k, _) -> k = j) 
              then 
                ode.powers.[i] 
                |> List.fold (fun t (k, p) -> 
                    if k = j 
                    then t * p * pops.[k] ** (p - 1.0)
                    else t * pops.[k] ** p) (rate |> get_k)
              else 0.0))    
    let jacobian pops =
      let flux_derivative = dFdx pops
      let m1 = Oslo.Matrix.ofArray matrix
      if num_reactions = 0 then Matrix.zeros num_species num_species
      else Oslo.Matrix.matrMultMatr m1 (Oslo.Matrix.ofArray flux_derivative)
    let drift (props:Vector) =
      [|0..num_reactions-1|]
        |> Array.mapi (fun i _ ->
            // Each column of stoich contains the net stoichiometries of reaction i              
            let v = Oslo.Matrix.copyCol ode.stoich i // Maybe replace with a GetColumn operation?
            Oslo.Matrix.matrMultScal (Lna.CrossProduct v v) (props.[i]) )
        |> Array.fold Matrix.add (Matrix.zeros num_species num_species)
    let props time (x:Vector) =
      let fluxes = Oslo.Vector.zeros num_reactions
      for i = 0 to (num_reactions - 1) do
        fluxes.[i] <- 
          match ode.rateDs.[i] with
          | Rate.MassAction r -> List.fold (fun t (j,p) -> t * x.[j] ** p) r ode.powers.[i]
          | Rate.Function (Lambda.Lambda f) -> f (fun id -> 
              match id with 
              | Inlined.Species i    -> x.[i]
              | Inlined.Time         -> time
              //| Inlined.IRate r       -> ratesEnv.[r]
              )
      fluxes
    { 
      ode = ode;
      outputconcentrations = true;
      initials = initials;
      stoich = matrix;
      covariance = Oslo.Matrix.zeros 0 0;
      times = List.empty;
      nextprinttime = 0.0;
      jacobian = jacobian;
      drift = drift;
      props = props;
      stepsdone = 0;
      scale = lna_scale;
    }
  member lna.simulate_callback (cancel:bool ref) (output:Row<Point> -> unit) =
    let N = lna.scale
    let Nhalf = sqrt N  
    (* Make sure we have no species events *)
    if List.exists (fun (ev:Event<_,_,_>) -> 
      match ev.target with Target.OutputPoint _ -> false | _ -> true) lna.ode.simulator.events
    then failwith "Events not supported for LNA integration"  
    (* Set up ODE solver enumerator *)
    //TODO: pass through console out settings
    //if console_print then System.Console.WriteLine("Performing LNA");
    //let endtime = sim_settings.final
    let ns = lna.initials.Length
    let split (x: float []) =
      ( x.[0..ns-1]
      , x.[ns..2*ns-1]
      , Array.init ns (fun r -> x.[(2 + r)*ns..(3 + r)*ns-1]) )   
    let f (t:float) (x:Vector) =
      let solution, means, variances = split (Vector.toArray x)
      let s = Oslo.Vector.ofArray solution
      let E = Oslo.Vector.ofArray means
      let C = Matrix.ofArray variances
      let props = lna.props t s
      let G = lna.drift props
      let J = lna.jacobian s
      let matrMultMatr = Oslo.Matrix.matrMultMatr
      //Operator overloading issue with WebSharper (therefore Oslo)
      //let C' = J * C + C * (J.Transpose()) + G in
      let C' = (Oslo.Matrix.add (Oslo.Matrix.add (matrMultMatr J C) (matrMultMatr C (Lna.OsloTranspose J))) G)
      [ Oslo.Matrix.matrMultVec (Oslo.Matrix.ofArray lna.stoich) props |> Vector.toArray
      ; Oslo.Matrix.matrMultVec J E |> Vector.toArray
      ; [|0..ns-1|] |> Array.collect (fun i -> C'.[i] |> Vector.toArray) ]
      |> Array.concat
      |> Oslo.Vector.ofArray 
    // Initial conditions
    let x0 = Array.append lna.initials (Array.zeroCreate (ns+ns*ns)) |> Oslo.Vector.ofArray
    let datapoint time (x:Vector) = 
      let values = Array.init ns (fun i -> x.[i])
      lna.ode.plots |> Array.map (fun spec ->
        let mean, weights = Lna.affine_plot values time spec
        let variance =
          seq { for i in 0 .. ns - 1 do
                  for j in 0 .. ns - 1 do
                    yield weights.[i] * weights.[j] * x.[2*ns + i*ns + j] } |> Seq.sum
        let std = sqrt (max 0.0 variance)
        if lna.outputconcentrations then Point.create mean (std / Nhalf)
        else Point.create (N * mean) (std * Nhalf))
    let integrator = Oslo_integrator.create lna.ode.name lna.ode.simulator datapoint Point.interpolate lna.ode.settings x0 f
    let updated_integrator = Oslo_integrator.simulate_callback cancel output integrator
    { lna with ode = { lna.ode with simulator = updated_integrator.simulator } }
  member lna.process_simulation sim_data = 
    let times:float list = lna.ode.simulator.settings.times
    let plots:string list = List.map Functional2.to_string_plot lna.ode.simulator.settings.plots
    if times = [] 
    then Table.from_rows_reverse plots sim_data
    else 
      let int_data:Row<Point> list = Row.interpolate_reverse Point.interpolate (List.rev sim_data) times
      Table.from_rows_reverse plots int_data
  member lna.simulate_state () =
    let cancel = ref false
    let result = ref []
    let output row = result := row::!result
    let final_sim = lna.simulate_callback cancel output
    final_sim, lna.process_simulation !result
  member lna.simulate () = snd <| lna.simulate_state()