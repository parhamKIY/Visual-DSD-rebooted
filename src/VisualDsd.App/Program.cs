using System.Globalization;
using System.Diagnostics;
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
            Console.WriteLine("VisualDsd [serve [--port 5800] [--open] | parse|expand|simulate|infer|analyze|synthesize|export <file|-> [--language dsd|crn] [--node NAME] [--system NAME] [--dialect auto|current|legacy] [--compilation default|detailed|finite|infinite] [--simulator oslo|ssa|lna|cme|pde|sundials|cmesundials|mc] [--initial N] [--final N] [--points N] [--seed N] [--timeout-seconds N] [--phase-x SPECIES] [--phase-y SPECIES] [--phase-trajectories N] [--data dataset.csv]]\nRepeat --data for multiple datasets. Run without arguments to open the local workspace in your browser.");
            return 0;
        }
        try
        {
            if (args.Length == 0 || args[0] == "serve")
            {
                int port = 5800;
                bool openBrowser = args.Length == 0;
                for (int index = 1; index < args.Length; index++)
                {
                    if (args[index] == "--open") openBrowser = true;
                    else if (args[index] == "--port" && index + 1 < args.Length) port = int.Parse(args[++index], CultureInfo.InvariantCulture);
                    else throw new ArgumentException("Usage: VisualDsd serve [--port 5800] [--open]");
                }
                if (port is < 0 or > 65535) throw new ArgumentException("Port must be between 0 and 65535.");
                await ServeAsync(port, openBrowser);
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
        if (args.Length < 2 || args[0] is not ("parse" or "expand" or "simulate" or "infer" or "analyze" or "synthesize" or "export")) throw new ArgumentException("Expected parse, expand, simulate, infer, analyze, synthesize, or export and a model file. Use --help for options.");
        if (args[1] != "-" && new FileInfo(args[1]).Length > RequestValidation.MaximumCodeBytes + 3)
            throw new ArgumentException("The model file exceeds 256 KiB.");
        string code = args[1] == "-" ? await ReadInputAsync(Console.In, RequestValidation.MaximumCodeBytes) : await File.ReadAllTextAsync(args[1]);
        var request = new ModelRequest { Code = code, Operation = args[0], Language = Path.GetExtension(args[1]).Equals(".crn", StringComparison.OrdinalIgnoreCase) ? "crn" : "dsd", Dialect = Path.GetExtension(args[1]).Equals(".vdsd", StringComparison.OrdinalIgnoreCase) ? "legacy" : "auto" };
        for (int index = 2; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length) throw new ArgumentException($"Missing value for {args[index]}.");
            string value = args[index + 1];
            request = args[index] switch
            {
                "--language" => request with { Language = value },
                "--node" => request with { NodeId = value },
                "--system" => request with { SystemId = value },
                "--dialect" => request with { Dialect = value },
                "--compilation" => request with { Compilation = value },
                "--simulator" => request with { Simulator = value },
                "--initial" => request with { Initial = double.Parse(value, CultureInfo.InvariantCulture) },
                "--final" => request with { Final = double.Parse(value, CultureInfo.InvariantCulture) },
                "--points" => request with { Points = int.Parse(value, CultureInfo.InvariantCulture) },
                "--seed" => request with { Seed = int.Parse(value, CultureInfo.InvariantCulture) },
                "--timeout-seconds" => request with { TimeoutSeconds = int.Parse(value, CultureInfo.InvariantCulture) },
                "--phase-x" => request with { PhaseX = value },
                "--phase-y" => request with { PhaseY = value },
                "--phase-trajectories" => request with { PhaseTrajectories = int.Parse(value, CultureInfo.InvariantCulture) },
                "--data" => request with { Data = [..request.Data, ObservationCsv.Parse(Path.GetFileNameWithoutExtension(value), await ReadCsvAsync(value))] },
                _ => throw new ArgumentException($"Unknown option {args[index]}.")
            };
        }
        return request;
    }

    private static async Task<string> ReadCsvAsync(string path)
    {
        if (new FileInfo(path).Length > 512 * 1024) throw new ArgumentException("Observation CSV exceeds 512 KiB.");
        return await File.ReadAllTextAsync(path);
    }

    private static async Task<int> RunWorkerAsync()
    {
        using var ownerLifetime = new WorkerLifetime();
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

    private static async Task ServeAsync(int port, bool openBrowser)
    {
        if (openBrowser && port != 0)
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            try
            {
                EngineInfo? existing = await client.GetFromJsonAsync<EngineInfo>($"http://127.0.0.1:{port}/api/info");
                if (existing?.Name == CoreEngine.Info.Name && existing.Version == CoreEngine.Info.Version)
                { OpenBrowser($"http://127.0.0.1:{port}"); return; }
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException) { }
        }
        WebApplicationBuilder builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4 * 1024 * 1024);
        await using var jobs = new JobCoordinator(new ProcessEngineWorker(WorkerCommand.Current()), Math.Min(2, Environment.ProcessorCount));
        await using WebApplication app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers.CacheControl = "no-cache";
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
        WebAssets.Map(app);
        app.MapGet("/health", () => Results.Ok(new { status = "ok", version = CoreEngine.Info.Version }));
        app.MapGet("/api/info", () => Results.Json(CoreEngine.Info));
        app.MapPost("/api/data/parse", (CsvDataRequest request) =>
        {
            try { return Results.Json(ObservationCsv.Parse(request.Name, request.Csv)); }
            catch (FormatException error) { return Results.Json(new { diagnostics = new[] { new Diagnostic("INVALID_DATA", error.Message) } }, statusCode: 400); }
        });
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
        if (openBrowser)
        {
            app.Lifetime.ApplicationStarted.Register(() =>
            {
                string? address = app.Urls.FirstOrDefault();
                if (address is null) return;
                OpenBrowser(address);
            });
        }
        await app.RunAsync();
    }

    private static void OpenBrowser(string address)
    {
        try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        { Console.WriteLine($"Open {address} in your browser to use the workspace."); }
    }
}
