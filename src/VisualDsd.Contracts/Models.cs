using System.Text;
using System.Text.Json.Serialization;

namespace VisualDsd.Contracts;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ModelRequest
{
    public string Code { get; init; } = "";
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
    public int TimeoutSeconds { get; init; } = 30;
    public DatasetData[] Data { get; init; } = [];
}

public sealed record Diagnostic(string Code, string Message, int? Line = null, int? Column = null);
public sealed record Participant(string SpeciesId, int Multiplicity);
public sealed record RateData(string Kind, string Expression);
public sealed record ReactionData(Participant[] Reactants, Participant[] Products, Participant[] Catalysts, RateData Rate, RateData? ReverseRate);
public sealed record SpeciesData(string Id, string Name, string Structure, string Svg, string Initial, bool Constant, string? Time, string ValueKind, string? SourceId = null);
public sealed record SeriesData(string Name, double[] Values, double[]? StandardDeviation = null);
public sealed record ObservationData(double[] Times, SeriesData[] Series, string? TimeUnit = null);
public sealed record DatasetData(string Name, ObservationData[] Tables);
public sealed record CsvDataRequest(string Name, string Csv);
public sealed record ParameterEstimateData(string Name, string Kind, double Mle, double Mean, double Variance, double Median,
    double Lower95, double Upper95, double[] Samples);
public sealed record InferenceData(long Seed, int BurnIn, int Iterations, int Thin, int RetainedSamples, int DataPoints,
    double MaxLogLikelihood, ParameterEstimateData[] Parameters, double[] LogLikelihood, ObservationData[] Observations);
public sealed record NetworkData(SpeciesData[] Species, ReactionData[] Reactions);
public sealed record SpatialSeriesData(string Name, double[][] Frames);
// Frames are indexed by time, then x-major cells: x * Y.Length + y (or x in 1D).
public sealed record SpatialData(int Dimensions, string Boundary, double[] X, double[] Y, double Dt, SpatialSeriesData[] Series);
public sealed record StateTransitionData(int Source, int Target, double Rate);
public sealed record StateSpaceData(string[] SpeciesIds, int InitialState, int[][] States, StateTransitionData[] Transitions);
public sealed record SimulationData(string Name, string Sweep, string Assignment, double[] Times, SeriesData[] Series, int? Seed,
    SettingsData? Settings = null, NetworkData? Network = null, SpatialData? Spatial = null, StateSpaceData? StateSpace = null);
public sealed record SettingsData(string Simulator, double Initial, double Final, int Points, int? Seed, string TimeUnit, string ConcentrationUnit);
public sealed record ModelData(string Kind, string Compilation, bool IsJit, SettingsData Settings, SpeciesData[] Species, ReactionData[] Reactions, SimulationData[] Simulations,
    InferenceData? Inference = null);
public sealed record EngineResponse(bool Success, string Operation, string Dialect, ModelData? Model, Diagnostic[] Diagnostics)
{
    public static EngineResponse Failure(ModelRequest request, string code, string message) =>
        new(false, request.Operation, request.Dialect, null, [new(code, message)]);
}

public sealed record JobView(string Id, string State, DateTimeOffset CreatedAt, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, EngineResponse? Result);
public sealed record EngineInfo(string Name, string Version, string[] Operations, string[] Dialects, string[] CompilationModes, string[] Simulators);

public static class RequestValidation
{
    public const int MaximumCodeBytes = 256 * 1024;

    public static Diagnostic[] Validate(ModelRequest? request)
    {
        if (request is null) return [new("INVALID_REQUEST", "A model request is required.")];
        var errors = new List<Diagnostic>();
        if (string.IsNullOrWhiteSpace(request.Code)) errors.Add(new("EMPTY_CODE", "Model code is required."));
        else if (Encoding.UTF8.GetByteCount(request.Code) > MaximumCodeBytes) errors.Add(new("CODE_TOO_LARGE", "Model code exceeds 256 KiB."));
        if (request.Code?.Contains('\0') == true) errors.Add(new("INVALID_CODE", "Model code contains a null character."));
        if (request.Operation is not ("parse" or "expand" or "simulate" or "infer" or "analyze")) errors.Add(new("INVALID_OPERATION", "Operation must be parse, expand, simulate, infer, or analyze."));
        if (request.Dialect is not ("auto" or "current" or "legacy")) errors.Add(new("INVALID_DIALECT", "Dialect must be auto, current, or legacy."));
        if (request.Compilation is not ("source" or "default" or "detailed" or "finite" or "infinite")) errors.Add(new("INVALID_COMPILATION", "Unknown compilation mode."));
        if (request.Simulator is not ("source" or "oslo" or "ssa" or "lna" or "cme" or "pde")) errors.Add(new("INVALID_SIMULATOR", "Simulator must be source, oslo, ssa, lna, cme, or pde."));
        errors.AddRange(ObservationValidation.Validate(request.Data));
        if (request.Operation == "infer" && request.Data is { Length: 0 }) errors.Add(new("MISSING_DATA", "Import observation data before fitting parameters."));
        if (request.Initial.HasValue && !double.IsFinite(request.Initial.Value)) errors.Add(new("INVALID_TIME", "Initial time must be finite."));
        if (request.Final.HasValue && !double.IsFinite(request.Final.Value)) errors.Add(new("INVALID_TIME", "Final time must be finite."));
        if (request.Initial.HasValue && request.Final.HasValue && request.Final <= request.Initial) errors.Add(new("INVALID_TIME_RANGE", "Final time must be greater than initial time."));
        if (request.Points is < 1 or > 100_000) errors.Add(new("INVALID_POINTS", "Points must be between 1 and 100000."));
        if (request.TimeoutSeconds is < 1 or > 120) errors.Add(new("INVALID_TIMEOUT", "Timeout must be between 1 and 120 seconds."));
        if ((request.Toeholds is { } toeholds && Encoding.UTF8.GetByteCount(toeholds) > MaximumCodeBytes) ||
            (request.Specificities is { } specificities && Encoding.UTF8.GetByteCount(specificities) > MaximumCodeBytes))
            errors.Add(new("DATABASE_TOO_LARGE", "A sequence database exceeds 256 KiB."));
        return errors.ToArray();
    }
}
