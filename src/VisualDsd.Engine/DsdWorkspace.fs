namespace VisualDsd.Engine

open System
open Microsoft.Research.DNA
open VisualDsd.Contracts

module DsdWorkspace =
    let defaults = SequenceDatabasesData(Options.default_options.toeholds, Options.default_options.specificities)
    let configure (request: ModelRequest) (opts: Options.t) =
        if isNull request.DsdOptions then opts else
        let value=request.DsdOptions
        let b (n: Nullable<bool>) old = if n.HasValue then n.Value else old
        let f (n: Nullable<float>) old = if n.HasValue then n.Value else old
        let i (n: Nullable<int>) old = if n.HasValue then n.Value else old
        { opts with
            leaks = b value.Leaks opts.leaks
            pin_leaks = b value.PinLeaks opts.pin_leaks
            polymers = b value.Polymers opts.polymers
            unproductive = b value.Unproductive opts.unproductive
            sequence_rates = b value.SequenceRates opts.sequence_rates
            declare_domains = b value.DeclareDomains opts.declare_domains
            check_dna = b value.CheckDna opts.check_dna
            colour_toeholds = b value.ColourToeholds opts.colour_toeholds
            plot_names = b value.PlotNames opts.plot_names
            state_images = b value.StateImages opts.state_images
            is_jit = b value.Jit opts.is_jit
            toehold_bind_rate = f value.ToeholdBindRate opts.toehold_bind_rate
            toehold_unbind_rate = f value.ToeholdUnbindRate opts.toehold_unbind_rate
            toehold_length = i value.ToeholdLength opts.toehold_length
            specificity_length = i value.SpecificityLength opts.specificity_length
            temperature = if value.Temperature.HasValue then (Options.setTemperature opts value.Temperature.Value).temperature else opts.temperature
            generate_predicates = match value.Predicates with "all" -> Options.All_predicates | "none" -> Options.No_predicates | _ -> opts.generate_predicates
            rendering = {
                renderer = match value.Renderer with "classic" -> Options.Classic | "circles" -> Options.Circles | "branches" -> Options.Branches | _ -> opts.rendering.renderer
                mode = match value.RenderMode with "complement" -> Options.Complement | "condensed" -> Options.Condensed | "nucleotides" -> Options.Nucleotides | _ -> opts.rendering.mode
                arrange = match value.Arrange with "wide" -> Options.Wide | "babylon" -> Options.Babylon | _ -> opts.rendering.arrange
                rotate_labels = b value.RotateLabels opts.rendering.rotate_labels } }

    let describe (bundle: Dsd.bundle) =
        let opts=Dsd.get_options bundle
        let options=DsdOptionsData(
            Leaks=Nullable(opts.leaks),
            PinLeaks=Nullable(opts.pin_leaks),
            Polymers=Nullable(opts.polymers),
            Unproductive=Nullable(opts.unproductive),
            SequenceRates=Nullable(opts.sequence_rates),
            DeclareDomains=Nullable(opts.declare_domains),
            CheckDna=Nullable(opts.check_dna),
            ColourToeholds=Nullable(opts.colour_toeholds),
            PlotNames=Nullable(opts.plot_names),
            StateImages=Nullable(opts.state_images),
            Jit=Nullable(opts.is_jit),
            ToeholdBindRate=Nullable(opts.toehold_bind_rate),
            ToeholdUnbindRate=Nullable(opts.toehold_unbind_rate),
            ToeholdLength=Nullable(opts.toehold_length),
            SpecificityLength=Nullable(opts.specificity_length),
            Temperature=Nullable(float opts.temperature),
            Predicates=(if opts.generate_predicates=Options.All_predicates then "all" else "none"),
            Renderer=(match opts.rendering.renderer with Options.Classic -> "classic" | Options.Circles -> "circles" | Options.Branches -> "branches"),
            RenderMode=(match opts.rendering.mode with Options.Complement -> "complement" | Options.Condensed -> "condensed" | Options.Nucleotides -> "nucleotides"),
            Arrange=(if opts.rendering.arrange=Options.Wide then "wide" else "babylon"),
            RotateLabels=Nullable(opts.rendering.rotate_labels))
        match bundle with
        | Dsd.Rules _ -> DsdWorkspaceData(options,"unavailable",[||],0,0)
        | Dsd.ClassicDSD classic ->
            let mapping=classic.meta.meta
            let assignments=mapping.assigned |> List.map(fun (domain,sequence) ->
                let text=sequence |> Option.map Sequence.string_of_sequence |> Option.defaultValue null
                let reverse=Sequence.get_domain mapping (Domain.complement domain) |> Option.flatten |> Option.map Sequence.string_of_sequence |> Option.defaultValue null
                DomainSequenceData(Domain.display_bare_domain domain,Domain.is_toehold domain,text,reverse)) |> List.sortBy(fun entry -> entry.Domain) |> List.toArray
            if assignments.Length>10000 then raise(ExecutionFailure("MODEL_TOO_LARGE","Domain sequence assignments exceed 10000 entries."))
            DsdWorkspaceData(options,(if assignments |> Array.exists(fun entry -> isNull entry.Sequence) then "incomplete" else "assigned"),assignments,mapping.toeholds.Length,mapping.specificities.Length)
