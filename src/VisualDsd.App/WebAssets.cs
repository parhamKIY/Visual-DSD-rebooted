using System.Reflection;
using System.Text;
using System.Text.Json;
using VisualDsd.Contracts;

namespace VisualDsd.App;

public sealed record ExampleInfo(string Id, string Name, string Description, string Dialect, string Language = "dsd", string Category = "Workspace", string? Source = null, string? Sha256 = null);
public sealed record ExampleModel(string Id, string Name, string Description, string Dialect, string Code, string Language = "dsd", DatasetData[]? Data = null, string Category = "Workspace", string? Source = null);

internal static class WebAssets
{
    private static readonly Assembly Assembly = typeof(WebAssets).Assembly;
    private static readonly Dictionary<string, string> Types = new(StringComparer.Ordinal)
    {
        ["index.html"] = "text/html; charset=utf-8", ["app.css"] = "text/css; charset=utf-8",
        ["app.js"] = "text/javascript; charset=utf-8", ["model.js"] = "text/javascript; charset=utf-8", ["layout.js"] = "text/javascript; charset=utf-8",
        ["chart.js"] = "text/javascript; charset=utf-8", ["network.js"] = "text/javascript; charset=utf-8",
        ["msagl.worker.js"] = "text/javascript; charset=utf-8", ["msagl.runtime.js"] = "text/javascript; charset=utf-8",
        ["logic-study.js"] = "text/javascript; charset=utf-8",
        ["logic-study-workspace.js"] = "text/javascript; charset=utf-8",
        ["course-export.js"] = "text/javascript; charset=utf-8",
        ["course-report.js"] = "text/javascript; charset=utf-8",
        ["adleman.js"] = "text/javascript; charset=utf-8",
        ["adleman-workspace.js"] = "text/javascript; charset=utf-8",
        ["logic-analysis.js"] = "text/javascript; charset=utf-8",
        ["logic-inspector.js"] = "text/javascript; charset=utf-8",
        ["logic.js"] = "text/javascript; charset=utf-8",
        ["logic-workspace.js"] = "text/javascript; charset=utf-8",
        ["logic-workspace.css"] = "text/css; charset=utf-8",
        ["logic-example.json"] = "application/json; charset=utf-8",
        ["student-workspace.js"] = "text/javascript; charset=utf-8",
        ["student-workspace.css"] = "text/css; charset=utf-8",
        ["learning-guide.js"] = "text/javascript; charset=utf-8",
        ["learning-guide.css"] = "text/css; charset=utf-8",
        ["live-jobs.js"] = "text/javascript; charset=utf-8", ["dsd-workspace.js"] = "text/javascript; charset=utf-8", ["exports.js"] = "text/javascript; charset=utf-8", ["synthesis.js"] = "text/javascript; charset=utf-8", ["posterior.js"] = "text/javascript; charset=utf-8", ["probabilities.js"] = "text/javascript; charset=utf-8", ["exploration.js"] = "text/javascript; charset=utf-8", ["program.js"] = "text/javascript; charset=utf-8", ["project.js"] = "text/javascript; charset=utf-8", ["observations.js"] = "text/javascript; charset=utf-8", ["icon.svg"] = "image/svg+xml"
    };

    private static readonly ExampleInfo[] WorkspaceExamples =
    [
        new("feedback", "CRN · negative feedback", "Compare open and closed autoregulation loops with explicitly illustrative mass-action rates.", "current", "crn"),
        new("synthesis-bistable", "CRN · bistable synthesis", "Two analytic stable equilibria, synthesized values and sampled phase trajectories.", "current", "crn"),
        new("synthesis-turing", "CRN · Turing synthesis", "Synthesize diffusion for a Brusselator and inspect its dispersion curve.", "current", "crn"),
        new("inference-linked", "CRN · linked inference", "Synthetic observations included: two chains per node and posterior transfer between fitted models.", "current", "crn"),
        new("lna-covariance", "CRN · covariance and scale", "Scaled copy populations and uncertainty of sums and differences, including cross-species covariance.", "current", "crn"),
        new("cme-distribution", "CRN · probability distribution", "Inspect joint CME probabilities, population heatmaps and marginal distributions.", "current", "crn"),
        new("jit-states", "JIT · reachable binding states", "Generate reachable population states lazily for a strand displacement model.", "current"),
        new("moment-closure", "CRN · moment closure", "Mean and uncertainty for molecular decay using second-order moments.", "current", "crn"),
        new("crn-systems", "CRN · two systems", "Two independent reaction networks sharing a rate parameter.", "current", "crn"),
        new("crn-graph", "CRN · linked models", "Select a node and system to simulate. Links record inference dependencies.", "current", "crn"),
        new("diffusion", "Diffusion pulse", "A 2D reaction-diffusion pulse with two diffusion coefficients.", "current"),
        new("state-switch", "Reversible state switch", "Explore the five reachable population states of a reversible switch.", "current"),
        new("catalytic", "Catalytic", "A strand displacement catalyst and its reaction network.", "current"),
        new("and-gate", "AND circuit", "Two inputs release a common output strand.", "current"),
        new("transducer", "Two-domain transducer", "Signal transfer through a two-domain gate.", "current"),
        new("join", "Join gate", "A small starting point for exploring strand displacement.", "current"),
        new("jit", "Just-in-time join", "Generate new species during stochastic simulation.", "current"),
        new("legacy-and", "AND circuit · legacy", "The original Visual DSD syntax, preserved as written.", "legacy")
    ];

    public static readonly ExampleInfo[] Examples = [.. WorkspaceExamples, .. ReadOriginalExamples()];
    private static ExampleInfo[] ReadOriginalExamples()
    {
        using Stream stream = Assembly.GetManifestResourceStream("VisualDsd.OriginalExamples") ?? throw new InvalidOperationException("The original example catalog is missing.");
        return JsonSerializer.Deserialize<ExampleInfo[]>(stream, ProcessEngineWorker.Json) ?? throw new InvalidOperationException("The original example catalog is invalid.");
    }

    public static IResult Asset(string name)
    {
        if (!Types.TryGetValue(name, out string? type)) return Results.NotFound();
        using Stream stream = Assembly.GetManifestResourceStream($"VisualDsd.Web.{name}") ?? throw new InvalidOperationException("An embedded application asset is missing.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return Results.Bytes(bytes.ToArray(), type);
    }

    public static IResult Example(string id)
    {
        ExampleInfo? info = Examples.FirstOrDefault(example => example.Id == id);
        if (info is null) return Results.NotFound();
        string resourceId = info.Source switch
        {
            "2-domain, DCM - Two-domain transducer.txt" => "transducer",
            "Catalytic.txt" => "catalytic",
            "Manual/Join-JIT.txt" => "jit",
            "Manual/Join.txt" => "join",
            "Simple - AND Circuit.txt" => "and-gate",
            _ => id
        };
        using Stream stream = Assembly.GetManifestResourceStream($"VisualDsd.Examples.{resourceId}") ?? throw new InvalidOperationException("An embedded example is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        using Stream? dataStream = Assembly.GetManifestResourceStream($"VisualDsd.Examples.{id}.data");
        using StreamReader? dataReader = dataStream is null ? null : new StreamReader(dataStream, Encoding.UTF8);
        DatasetData[]? data = dataReader is null ? null : JsonSerializer.Deserialize<DatasetData[]>(dataReader.ReadToEnd(), ProcessEngineWorker.Json);
        return Results.Json(new ExampleModel(info.Id, info.Name, info.Description, info.Dialect, reader.ReadToEnd(), info.Language, data, info.Category, info.Source));
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/", () => Asset("index.html"));
        app.MapGet("/assets/{name}", (string name) => Asset(name));
        app.MapGet("/api/sequences/defaults", () => Results.Json(VisualDsd.Engine.Engine.SequenceDatabases));
        app.MapGet("/api/examples", () => Results.Json(Examples));
        app.MapGet("/api/examples/{id}", (string id) => Example(id));
    }
}
