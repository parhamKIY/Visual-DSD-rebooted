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
}

public sealed record Diagnostic(string Code, string Message, int? Line = null, int? Column = null);
public sealed record Participant(string SpeciesId, int Multiplicity);
public sealed record RateData(string Kind, string Expression);
public sealed record ReactionData(Participant[] Reactants, Participant[] Products, Participant[] Catalysts, RateData Rate, RateData? ReverseRate);
public sealed record SpeciesData(string Id, string Name, string Structure, string Svg, string Initial, bool Constant, string? Time);
public sealed record SeriesData(string Name, double[] Values);
public sealed record SimulationData(string Name, string Sweep, string Assignment, double[] Times, SeriesData[] Series, int? Seed);
public sealed record SettingsData(string Simulator, double Initial, double Final, int Points, int? Seed, string TimeUnit, string ConcentrationUnit);
public sealed record ModelData(string Kind, string Compilation, bool IsJit, SettingsData Settings, SpeciesData[] Species, ReactionData[] Reactions, SimulationData[] Simulations);
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
        if (request.Operation is not ("parse" or "expand" or "simulate")) errors.Add(new("INVALID_OPERATION", "Operation must be parse, expand, or simulate."));
        if (request.Dialect is not ("auto" or "current" or "legacy")) errors.Add(new("INVALID_DIALECT", "Dialect must be auto, current, or legacy."));
        if (request.Compilation is not ("source" or "default" or "detailed" or "finite" or "infinite")) errors.Add(new("INVALID_COMPILATION", "Unknown compilation mode."));
        if (request.Simulator is not ("source" or "oslo" or "ssa")) errors.Add(new("INVALID_SIMULATOR", "Simulator must be source, oslo, or ssa."));
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
