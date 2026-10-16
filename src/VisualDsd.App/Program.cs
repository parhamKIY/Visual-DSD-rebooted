using System.Globalization;
using System.Text;
using System.Text.Json;
using VisualDsd.Contracts;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.App;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        if (args.SequenceEqual(["--worker"])) return await RunWorkerAsync();
        if (args.SequenceEqual(["--version"])) { Console.WriteLine(CoreEngine.Info.Version); return 0; }
        if (args.SequenceEqual(["--help"]) || args.SequenceEqual(["help"]))
        {
            Console.WriteLine("VisualDsd [serve [--port 5800] | parse|expand|simulate <file|-> [--dialect auto|current|legacy] [--compilation default|detailed|finite|infinite] [--simulator oslo|ssa] [--initial N] [--final N] [--points N] [--seed N] [--timeout-seconds N]]");
            return 0;
        }
        try
        {
            if (args.Length == 0 || args[0] == "serve")
            {
                int port = args.Length switch
                {
                    0 or 1 => 5800,
                    3 when args[1] == "--port" => int.Parse(args[2], CultureInfo.InvariantCulture),
                    _ => throw new ArgumentException("Usage: VisualDsd serve [--port 5800]")
                };
                if (port is < 0 or > 65535) throw new ArgumentException("Port must be between 0 and 65535.");
                await ServeAsync(port);
                return 0;
            }
            ModelRequest request = await ParseCommandAsync(args);
            Diagnostic[] validation = RequestValidation.Validate(request);
            if (validation.Length > 0)
            {
                await WriteAsync(new EngineResponse(false, request.Operation, request.Dialect, null, validation));
                return 2;
            }
            using var cancellation = new CancellationTokenSource();
            ConsoleCancelEventHandler cancel = (_, e) => { e.Cancel = true; cancellation.Cancel(); };
            Console.CancelKeyPress += cancel;
            try
            {
                var worker = new ProcessEngineWorker(WorkerCommand.Current());
                EngineResponse result = await worker.ExecuteAsync(request, cancellation.Token);
                await WriteAsync(result);
                return result.Success ? 0 : 1;
            }
            catch (WorkerFailure error)
            {
                await WriteAsync(EngineResponse.Failure(request, error.Code, error.Message));
                return 1;
            }
            catch (OperationCanceledException)
            {
                await WriteAsync(EngineResponse.Failure(request, "CANCELLED", "The model was cancelled."));
                return 130;
            }
            finally { Console.CancelKeyPress -= cancel; }
        }
        catch (Exception error) when (error is ArgumentException or FormatException or OverflowException or IOException or UnauthorizedAccessException)
        {
            await WriteAsync(new EngineResponse(false, "", "", null, [new("COMMAND_ERROR", error.Message)]));
            return 2;
        }
    }

    private static async Task<ModelRequest> ParseCommandAsync(string[] args)
    {
        if (args.Length < 2 || args[0] is not ("parse" or "expand" or "simulate")) throw new ArgumentException("Expected parse, expand, or simulate and a model file. Use --help for options.");
        if (args[1] != "-" && new FileInfo(args[1]).Length > RequestValidation.MaximumCodeBytes + 3)
            throw new ArgumentException("The model file exceeds 256 KiB.");
        string code = args[1] == "-" ? await ReadInputAsync(Console.In, RequestValidation.MaximumCodeBytes) : await File.ReadAllTextAsync(args[1]);
        var request = new ModelRequest { Code = code, Operation = args[0], Dialect = Path.GetExtension(args[1]).Equals(".vdsd", StringComparison.OrdinalIgnoreCase) ? "legacy" : "auto" };
        for (int index = 2; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length) throw new ArgumentException($"Missing value for {args[index]}.");
            string value = args[index + 1];
            request = args[index] switch
            {
                "--dialect" => request with { Dialect = value },
                "--compilation" => request with { Compilation = value },
                "--simulator" => request with { Simulator = value },
                "--initial" => request with { Initial = double.Parse(value, CultureInfo.InvariantCulture) },
                "--final" => request with { Final = double.Parse(value, CultureInfo.InvariantCulture) },
                "--points" => request with { Points = int.Parse(value, CultureInfo.InvariantCulture) },
                "--seed" => request with { Seed = int.Parse(value, CultureInfo.InvariantCulture) },
                "--timeout-seconds" => request with { TimeoutSeconds = int.Parse(value, CultureInfo.InvariantCulture) },
                _ => throw new ArgumentException($"Unknown option {args[index]}.")
            };
        }
        return request;
    }

    private static async Task<int> RunWorkerAsync()
    {
        TextWriter output = Console.Out;
        Console.SetOut(TextWriter.Null);
        EngineResponse result;
        try
        {
            string json = await ReadInputAsync(Console.In, 4 * 1024 * 1024);
            ModelRequest? request = JsonSerializer.Deserialize<ModelRequest>(json, ProcessEngineWorker.Json);
            result = request is null
                ? new(false, "", "", null, [new("INVALID_REQUEST", "A model request is required.")])
                : CoreEngine.Execute(request);
        }
        catch (Exception error) when (error is JsonException or IOException or ArgumentException)
        {
            result = new(false, "", "", null, [new("INVALID_REQUEST", "The model worker received an invalid request.")]);
        }
        await output.WriteLineAsync(JsonSerializer.Serialize(result, ProcessEngineWorker.Json));
        return result.Success ? 0 : 1;
    }

    private static async Task<string> ReadInputAsync(TextReader reader, int limit)
    {
        var input = new StringBuilder();
        char[] buffer = new char[4096];
        int count;
        while ((count = await reader.ReadAsync(buffer)) > 0)
        {
            if (input.Length + count > limit) throw new IOException("Input exceeds its size limit.");
            input.Append(buffer, 0, count);
        }
        return input.ToString();
    }

    private static Task WriteAsync(EngineResponse response) => Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, ProcessEngineWorker.Json));

    private static async Task ServeAsync(int port)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4 * 1024 * 1024);
        await using var jobs = new JobCoordinator(new ProcessEngineWorker(WorkerCommand.Current()), Math.Min(2, Environment.ProcessorCount));
        await using WebApplication app = builder.Build();
        app.Use(async (context, next) =>
        {
            string host = context.Request.Host.Host;
            if (host != "127.0.0.1" && !host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) { context.Response.StatusCode = 400; return; }
            string? origin = context.Request.Headers.Origin;
            if (!string.IsNullOrEmpty(origin) && (!Uri.TryCreate(origin, UriKind.Absolute, out Uri? uri) || uri.Scheme != "http" || !uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) || uri.Port != context.Connection.LocalPort))
            {
                context.Response.StatusCode = 403;
                return;
            }
            await next(context);
        });
        app.MapGet("/", () => Results.Json(CoreEngine.Info));
        app.MapGet("/health", () => Results.Ok(new { status = "ok", version = CoreEngine.Info.Version }));
        app.MapGet("/api/info", () => Results.Json(CoreEngine.Info));
        app.MapGet("/api/jobs", () => Results.Json(jobs.List()));
        app.MapGet("/api/jobs/{id}", (string id) => jobs.Get(id) is { } job ? Results.Json(job) : Results.NotFound());
        app.MapPost("/api/jobs", (ModelRequest request) =>
        {
            JobAdmission admission = jobs.Enqueue(request);
            return admission.Job is { } job
                ? Results.Json(job, statusCode: 202)
                : Results.Json(new { diagnostics = admission.Diagnostics }, statusCode: admission.Busy ? 429 : 400);
        });
        app.MapDelete("/api/jobs/{id}", (string id) => jobs.Cancel(id) is { } job ? Results.Json(job, statusCode: 202) : Results.NotFound());
        await app.RunAsync();
    }
}
