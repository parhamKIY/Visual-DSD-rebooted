using System.Reflection;
using System.Text;

namespace VisualDsd.App;

public sealed record ExampleInfo(string Id, string Name, string Description, string Dialect);
public sealed record ExampleModel(string Id, string Name, string Description, string Dialect, string Code);

internal static class WebAssets
{
    private static readonly Assembly Assembly = typeof(WebAssets).Assembly;
    private static readonly Dictionary<string, string> Types = new(StringComparer.Ordinal)
    {
        ["index.html"] = "text/html; charset=utf-8", ["app.css"] = "text/css; charset=utf-8",
        ["app.js"] = "text/javascript; charset=utf-8", ["model.js"] = "text/javascript; charset=utf-8",
        ["chart.js"] = "text/javascript; charset=utf-8", ["icon.svg"] = "image/svg+xml"
    };

    public static readonly ExampleInfo[] Examples =
    [
        new("catalytic", "Catalytic", "A strand displacement catalyst and its reaction network.", "current"),
        new("and-gate", "AND circuit", "Two inputs release a common output strand.", "current"),
        new("transducer", "Two-domain transducer", "Signal transfer through a two-domain gate.", "current"),
        new("join", "Join gate", "A small starting point for exploring strand displacement.", "current"),
        new("jit", "Just-in-time join", "Generate new species during stochastic simulation.", "current"),
        new("legacy-and", "AND circuit · legacy", "The original Visual DSD syntax, preserved as written.", "legacy")
    ];

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
        using Stream stream = Assembly.GetManifestResourceStream($"VisualDsd.Examples.{id}") ?? throw new InvalidOperationException("An embedded example is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return Results.Json(new ExampleModel(info.Id, info.Name, info.Description, info.Dialect, reader.ReadToEnd()));
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/", () => Asset("index.html"));
        app.MapGet("/assets/{name}", (string name) => Asset(name));
        app.MapGet("/api/examples", () => Results.Json(Examples));
        app.MapGet("/api/examples/{id}", (string id) => Example(id));
    }
}
