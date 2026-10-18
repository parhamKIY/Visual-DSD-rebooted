using System.Text;
using System.Text.Json.Serialization;

namespace VisualDsd.Contracts;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ModelRequest
{
    public string Code { get; init; } = "";
    public string Language { get; init; } = "dsd";
    public string? NodeId { get; init; }
    public string? SystemId { get; init; }
    public string Dialect { get; init; } = "auto";
    public string Operation { get; init; } = "parse";
    public string Compilation { get; init; } = "source";
    public string Simulator { get; init; } = "source";
    public double? Initial { get; init; }
    public double? Final { get; init; }
    public int? Points { get; init; }
    public int? Seed { get; init; }
    public string? Toeholds { get; init; }
    public string? Specificities { get; init; }
    public DsdOptionsData? DsdOptions { get; init; }
    public string? PhaseX { get; init; }
    public string? PhaseY { get; init; }
    public int PhaseTrajectories { get; init; } = 12;
    public int TimeoutSeconds { get; init; } = 30;
    public DatasetData[] Data { get; init; } = [];
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DsdOptionsData
{
    public bool? Leaks { get; init; }
    public bool? PinLeaks { get; init; }
    public bool? Polymers { get; init; }
    public bool? Unproductive { get; init; }
    public bool? SequenceRates { get; init; }
    public bool? DeclareDomains { get; init; }
    public bool? CheckDna { get; init; }
    public bool? ColourToeholds { get; init; }
    public bool? PlotNames { get; init; }
    public bool? StateImages { get; init; }
    public bool? Jit { get; init; }
    public double? ToeholdBindRate { get; init; }
    public double? ToeholdUnbindRate { get; init; }
    public int? ToeholdLength { get; init; }
    public int? SpecificityLength { get; init; }
    public double? Temperature { get; init; }
    public string? Predicates { get; init; }
    public string? Renderer { get; init; }
    public string? RenderMode { get; init; }
    public string? Arrange { get; init; }
    public bool? RotateLabels { get; init; }
}
public sealed record SequenceDatabasesData(string Toeholds, string Specificities);
public sealed record DomainSequenceData(string Domain, bool IsToehold, string? Sequence, string? ReverseComplement);
public sealed record DsdWorkspaceData(DsdOptionsData Options, string SequenceStatus, DomainSequenceData[] Sequences, int RemainingToeholds, int RemainingSpecificities);

public sealed record Diagnostic(string Code, string Message, int? Line = null, int? Column = null);
public sealed record Participant(string SpeciesId, int Multiplicity);
public sealed record RateData(string Kind, string Expression);
public sealed record ReactionData(Participant[] Reactants, Participant[] Products, Participant[] Catalysts, RateData Rate, RateData? ReverseRate);
public sealed record SpeciesData(string Id, string Name, string Structure, string Svg, string Initial, bool Constant, string? Time, string ValueKind, string? SourceId = null, string? SpatialInitial = null);
public sealed record SeriesData(string Name, double[] Values, double[]? StandardDeviation = null);
public sealed record ObservationData(double[] Times, SeriesData[] Series, string? TimeUnit = null);
public sealed record DatasetData(string Name, ObservationData[] Tables);
public sealed record CsvDataRequest(string Name, string Csv);
public sealed record ParameterEstimateData(string Name, string Kind, double Mle, double Mean, double Variance, double Median,
    double Lower95, double Upper95, double[] Samples, double? SplitRHat = null);
public sealed record InferenceChainData(long Seed, bool Included, double MaxLogLikelihood, ParameterEstimateData[] Parameters, double[] LogLikelihood, int[] Iterations, double[] LogPrior);
public sealed record ParameterPriorData(string Name, double Initial, string Distribution, string Interval, bool Variable);
public sealed record InferenceData(long Seed, int BurnIn, int Iterations, int Thin, int RetainedSamples, int DataPoints,
    double MaxLogLikelihood, ParameterEstimateData[] Parameters, double[] LogLikelihood, ObservationData[] Observations, InferenceChainData[]? Chains = null, double? LowerBound = null, ParameterPriorData[]? Priors = null);
public sealed record NetworkData(SpeciesData[] Species, ReactionData[] Reactions);
public sealed record SpatialSeriesData(string Name, double[][] Frames);
// Frames are indexed by time, then x-major cells: x * Y.Length + y (or x in 1D).
public sealed record SpatialData(int Dimensions, string Boundary, double[] X, double[] Y, double Dt, SpatialSeriesData[] Series);
public sealed record StateTransitionData(int Source, int Target, double Rate);
public sealed record StateSpaceData(string[] SpeciesIds, int InitialState, int[][] States, StateTransitionData[] Transitions);
public sealed record ProbabilityData(string[] SpeciesIds, int[][] States, double[][] Mass, double MaximumMassError);
public sealed record SimulationData(string Name, string Sweep, string Assignment, double[] Times, SeriesData[] Series, int? Seed,
    SettingsData? Settings = null, NetworkData? Network = null, SpatialData? Spatial = null, StateSpaceData? StateSpace = null, ProbabilityData? Probabilities = null);
public sealed record SettingsData(string Simulator, double Initial, double Final, int Points, int? Seed, string TimeUnit, string ConcentrationUnit);
public sealed record InferenceNodeData(string NodeId, SettingsData Settings, NetworkData Network, SimulationData[] Simulations, InferenceData Inference);
public sealed record CrnSystemData(string Id, int SpeciesCount, int ReactionCount);
public sealed record CrnNodeData(string Id, CrnSystemData[] Systems);
public sealed record CrnLocationData(string NodeId, string SystemId);
public sealed record CrnPriorData(string SourceParameter, string TargetParameter, string Kind);
public sealed record CrnEdgeData(CrnLocationData Source, CrnLocationData Target, CrnPriorData[] Parameters);
public sealed record CrnProgramData(string Source, CrnNodeData[] Nodes, CrnEdgeData[] Edges, string SelectedNodeId, string SelectedSystemId);
public sealed record SynthesisValueData(string Name, string Kind, double Value, double? LowerBound, double? UpperBound);
public sealed record EquilibriumData(string Name, string[] Species, double[] Values, double[] Residuals, double MaximumRealEigenvalue, double[][] Jacobian);
public sealed record DispersionData(double[] WaveNumbers, double[] GrowthRates, double WitnessWaveNumber, double WitnessGrowthRate);
public sealed record PhaseTrajectoryData(double InitialX, double InitialY, double[] Times, double[] X, double[] Y, int NearestEquilibrium, double FinalDistance);
public sealed record PhasePortraitData(string SpeciesX, string SpeciesY, double[] EquilibriumX, double[] EquilibriumY, PhaseTrajectoryData[] Trajectories);
public sealed record SynthesisData(string Mode, string Solver, string Status, double SolverSeconds, SynthesisValueData[] Values,
    string RateEquations, string Jacobian, string Diffusion, string Constraints, EquilibriumData[] Equilibria, DispersionData? Dispersion,
    PhasePortraitData? PhasePortrait, string? Code, int? Seed);
public sealed record ExportData(string Id, string Name, string FileName, string ContentType, string? Content, Diagnostic? Diagnostic, string Run, string Sweep, string Assignment);
public sealed record ModelData(string Kind, string Compilation, bool IsJit, SettingsData Settings, SpeciesData[] Species, ReactionData[] Reactions, SimulationData[] Simulations,
    InferenceData? Inference = null, string? CrnCode = null, CrnProgramData? Program = null, InferenceNodeData[]? InferenceNodes = null, SynthesisData? Synthesis = null, ExportData[]? Exports = null, DsdWorkspaceData? Dsd = null);
public sealed record EngineResponse(bool Success, string Operation, string Dialect, ModelData? Model, Diagnostic[] Diagnostics)
{
    public static EngineResponse Failure(ModelRequest request, string code, string message) =>
        new(false, request.Operation, request.Dialect, null, [new(code, message)]);
}

public sealed record JobView(string Id, string State, DateTimeOffset CreatedAt, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, EngineResponse? Result, EngineProgress? Progress = null, long Revision = 0, string? RemoteId = null, string? EngineVersion = null);
public sealed record EngineInfo(string Name, string Version, string[] Operations, string[] Dialects, string[] CompilationModes, string[] Simulators, string[]? Languages = null);

public static class RequestValidation
{
    public const int MaximumCodeBytes = 256 * 1024;

    public static Diagnostic[] Validate(ModelRequest? request)
    {
        if (request is null) return [new("INVALID_REQUEST", "A model request is required.")];
        var errors = new List<Diagnostic>();
        if (request.Language is not ("dsd" or "crn")) errors.Add(new("INVALID_LANGUAGE", "Language must be dsd or crn."));
        if (request.NodeId?.Length > 128 || request.SystemId?.Length > 128) errors.Add(new("INVALID_SELECTION", "Node and system identifiers cannot exceed 128 characters."));
        if (request.Language == "dsd" && (request.NodeId is not null || request.SystemId is not null)) errors.Add(new("INVALID_SELECTION", "Node and system selection requires CRN input."));
        if (request.Language == "crn" && (request.Dialect == "legacy" || request.Compilation != "source" || request.Toeholds is not null || request.Specificities is not null))
            errors.Add(new("CRN_OPTIONS", "CRN input uses current syntax and does not use DSD compilation or sequence databases."));
        if (request.Language == "crn" && request.DsdOptions is not null) errors.Add(new("CRN_OPTIONS", "DSD options require DSD input."));
        if (request.DsdOptions is { } dsd)
        {
            if (dsd.Renderer is not (null or "classic" or "circles" or "branches") || dsd.RenderMode is not (null or "complement" or "condensed" or "nucleotides") || dsd.Arrange is not (null or "wide" or "babylon") || dsd.Predicates is not (null or "all" or "none"))
                errors.Add(new("DSD_OPTIONS", "Unknown DSD rendering or predicate setting."));
            if (new[] { dsd.ToeholdBindRate, dsd.ToeholdUnbindRate }.Any(v => v.HasValue && (!double.IsFinite(v.Value) || v.Value < 0))) errors.Add(new("DSD_OPTIONS", "Toehold rates must be finite and nonnegative."));
            if (dsd.ToeholdLength is < 1 or > 256 || dsd.SpecificityLength is < 1 or > 256) errors.Add(new("DSD_OPTIONS", "Domain lengths must be between 1 and 256."));
            if (dsd.Temperature.HasValue && (!double.IsFinite(dsd.Temperature.Value) || dsd.Temperature.Value <= -273.15 || dsd.Temperature.Value > 1000)) errors.Add(new("DSD_OPTIONS", "Temperature must be finite, above absolute zero and at most 1000 C."));
        }
        if (string.IsNullOrWhiteSpace(request.Code)) errors.Add(new("EMPTY_CODE", "Model code is required."));
        else if (Encoding.UTF8.GetByteCount(request.Code) > MaximumCodeBytes) errors.Add(new("CODE_TOO_LARGE", "Model code exceeds 256 KiB."));
        if (request.Code?.Contains('\0') == true) errors.Add(new("INVALID_CODE", "Model code contains a null character."));
        if (request.Operation is not ("parse" or "expand" or "simulate" or "infer" or "analyze" or "synthesize" or "export")) errors.Add(new("INVALID_OPERATION", "Operation must be parse, expand, simulate, infer, analyze, synthesize, or export."));
        if (request.Dialect is not ("auto" or "current" or "legacy")) errors.Add(new("INVALID_DIALECT", "Dialect must be auto, current, or legacy."));
        if (request.Compilation is not ("source" or "default" or "detailed" or "finite" or "infinite")) errors.Add(new("INVALID_COMPILATION", "Unknown compilation mode."));
        if (request.Simulator is not ("source" or "oslo" or "ssa" or "lna" or "cme" or "pde" or "sundials" or "cmesundials" or "mc")) errors.Add(new("INVALID_SIMULATOR", "Simulator must be source, oslo, ssa, lna, cme, pde, sundials, cmesundials, or mc."));
        errors.AddRange(ObservationValidation.Validate(request.Data));
        if (request.Operation == "infer" && request.Data is { Length: 0 }) errors.Add(new("MISSING_DATA", "Import observation data before fitting parameters."));
        if (request.Initial.HasValue && !double.IsFinite(request.Initial.Value)) errors.Add(new("INVALID_TIME", "Initial time must be finite."));
        if (request.Final.HasValue && !double.IsFinite(request.Final.Value)) errors.Add(new("INVALID_TIME", "Final time must be finite."));
        if (request.Initial.HasValue && request.Final.HasValue && request.Final <= request.Initial) errors.Add(new("INVALID_TIME_RANGE", "Final time must be greater than initial time."));
        if (request.Points is < 1 or > 100_000) errors.Add(new("INVALID_POINTS", "Points must be between 1 and 100000."));
        if (request.TimeoutSeconds is < 1 or > 86400) errors.Add(new("INVALID_TIMEOUT", "Timeout must be between 1 and 86400 seconds."));
        if ((request.Toeholds is { } toeholds && Encoding.UTF8.GetByteCount(toeholds) > MaximumCodeBytes) ||
            (request.Specificities is { } specificities && Encoding.UTF8.GetByteCount(specificities) > MaximumCodeBytes))
            errors.Add(new("DATABASE_TOO_LARGE", "A sequence database exceeds 256 KiB."));
        if (request.PhaseTrajectories is < 0 or > 16) errors.Add(new("SYNTHESIS_PHASE", "Phase portraits support 0–16 trajectories."));
        if (request.PhaseX?.Length > 128 || request.PhaseY?.Length > 128 || (request.PhaseX is null) != (request.PhaseY is null))
            errors.Add(new("SYNTHESIS_PHASE", "Specify both phase-portrait species, each at most 128 characters."));
        return errors.ToArray();
    }
}
