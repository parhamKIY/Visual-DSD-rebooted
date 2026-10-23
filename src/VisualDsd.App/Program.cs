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
            Console.WriteLine("VisualDsd [serve|compute [--port 5800] [--jobs-dir PATH] [--open] | parse|expand|simulate|infer|analyze|synthesize|export <file|-> [--language dsd|crn] [--node NAME] [--system NAME] [--dialect auto|current|legacy] [--compilation default|detailed|finite|infinite] [--simulator oslo|ssa|lna|cme|pde|sundials|cmesundials|mc] [--initial N] [--final N] [--points N] [--seed N] [--timeout-seconds N] [--phase-x SPECIES] [--phase-y SPECIES] [--phase-trajectories N] [--toeholds file.txt] [--specificities file.txt] [--dsd-options options.json] [--data dataset.csv]]\nRepeat --data for multiple datasets. Run without arguments to open the local workspace in your browser.");
            return 0;
        }
        try
        {
            if (args.Length == 0 || args[0] is "serve" or "compute")
            {
                int port = 5800;
                bool compute=args.Length>0 && args[0]=="compute";
                string? jobsDirectory=null;
                bool openBrowser = args.Length == 0;
                for (int index = 1; index < args.Length; index++)
                {
                    if (args[index] == "--open") openBrowser = true;
                    else if(args[index]=="--jobs-dir" && index+1<args.Length)jobsDirectory=args[++index];
                    else if (args[index] == "--port" && index + 1 < args.Length) port = int.Parse(args[++index], CultureInfo.InvariantCulture);
                    else throw new ArgumentException("Usage: VisualDsd serve|compute [--port 5800] [--jobs-dir PATH] [--open]");
                }
                if (port is < 0 or > 65535) throw new ArgumentException("Port must be between 0 and 65535.");
                await ServeAsync(port, openBrowser && !compute,jobsDirectory,compute);
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
        catch (Exception error) when (error is ArgumentException or FormatException or OverflowException or IOException or UnauthorizedAccessException or JsonException)
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
                "--toeholds" => request with { Toeholds = await ReadDatabaseAsync(value) },
                "--specificities" => request with { Specificities = await ReadDatabaseAsync(value) },
                "--dsd-options" => request with { DsdOptions = JsonSerializer.Deserialize<DsdOptionsData>(await ReadDatabaseAsync(value), ProcessEngineWorker.Json) ?? throw new ArgumentException("DSD options require a JSON object.") },
                "--data" => request with { Data = [..request.Data, ObservationCsv.Parse(Path.GetFileNameWithoutExtension(value), await ReadCsvAsync(value))] },
                _ => throw new ArgumentException($"Unknown option {args[index]}.")
            };
        }
        return request;
    }

    private static async Task<string> ReadDatabaseAsync(string path)
    {
        if (new FileInfo(path).Length > RequestValidation.MaximumCodeBytes + 3) throw new ArgumentException("Options or sequence database file exceeds 256 KiB.");
        string text=await File.ReadAllTextAsync(path);
        if (System.Text.Encoding.UTF8.GetByteCount(text)>RequestValidation.MaximumCodeBytes) throw new ArgumentException("Options or sequence database file exceeds 256 KiB.");
        return text;
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
                : ExecuteObserved(request,output);
        }
        catch (Exception error) when (error is JsonException or IOException or ArgumentException)
        {
            result = new(false, "", "", null, [new("INVALID_REQUEST", "The model worker received an invalid request.")]);
        }
        await output.WriteLineAsync(JsonSerializer.Serialize(result, ProcessEngineWorker.Json));
        return result.Success ? 0 : 1;
    }

    private static EngineResponse ExecuteObserved(ModelRequest request,TextWriter output)
    {
        if(Environment.GetEnvironmentVariable("VISUAL_DSD_PROGRESS")!="1")return CoreEngine.Execute(request);
        using var telemetry=EngineTelemetry.Begin(progress=>{output.WriteLine("@progress "+JsonSerializer.Serialize(progress,ProcessEngineWorker.Json));output.Flush();});
        return CoreEngine.Execute(request);
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

    private static async Task ServeAsync(int port, bool openBrowser,string? jobsDirectory,bool compute)
    {
        string? computeToken=compute?Environment.GetEnvironmentVariable("VISUAL_DSD_COMPUTE_TOKEN"):null;
        if(compute && (computeToken is null || computeToken.Length<32 || computeToken.Length>4096 || computeToken.Any(char.IsControl)))throw new ArgumentException("Set VISUAL_DSD_COMPUTE_TOKEN to a secret of 32..4096 characters before starting compute mode.");
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
        string? remoteAddress=compute?null:Environment.GetEnvironmentVariable("VISUAL_DSD_REMOTE_URL");
        using var remote=string.IsNullOrWhiteSpace(remoteAddress)?null:new RemoteEngineWorker(new Uri(remoteAddress),Environment.GetEnvironmentVariable("VISUAL_DSD_REMOTE_TOKEN")??"",CoreEngine.Info.Version);
        var store=jobsDirectory is not null?new JobStore(jobsDirectory):port==0?null:new JobStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"VisualDsdRebooted","jobs-"+port));
        await using var jobs = new JobCoordinator(remote??(IEngineWorker)new ProcessEngineWorker(WorkerCommand.Current()), Math.Min(2, Environment.ProcessorCount),store:store,engineVersion:CoreEngine.Info.Version);
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
            if(compute)
            {
                string authorization=context.Request.Headers.Authorization.ToString();
                byte[] actual=System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(authorization));
                byte[] expected=System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes("Bearer "+computeToken));
                if(!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(actual,expected)){context.Response.StatusCode=401;return;}
            }
            await next(context);
        });
        if(!compute){WebAssets.Map(app);NcbiRecords.Map(app);}
        app.MapGet("/api/execution",()=>Results.Json(new{mode=remote is null?"local":"remote",persistent=store is not null,maximumTimeoutSeconds=86400}));
        app.MapGet("/health", () => Results.Ok(new { status = "ok", version = CoreEngine.Info.Version }));
        app.MapGet("/api/info", () => Results.Json(CoreEngine.Info));
        app.MapPost("/api/data/parse", (CsvDataRequest request) =>
        {
            try { return Results.Json(ObservationCsv.Parse(request.Name, request.Csv)); }
            catch (FormatException error) { return Results.Json(new { diagnostics = new[] { new Diagnostic("INVALID_DATA", error.Message) } }, statusCode: 400); }
        });
        JobEndpoints.Map(app,jobs);
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
