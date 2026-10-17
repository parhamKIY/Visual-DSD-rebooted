using System.Diagnostics;
using System.Text;
using System.Text.Json;
using VisualDsd.Contracts;

namespace VisualDsd.App;

public interface IEngineWorker
{
    Task<EngineResponse> ExecuteAsync(ModelRequest request, CancellationToken cancellationToken);
}

public sealed class WorkerFailure(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed record WorkerCommand(string Executable, string[] PrefixArguments)
{
    public static WorkerCommand Current()
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("The application executable was not found.");
        string entry = Environment.GetCommandLineArgs()[0];
        return Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase) && entry.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
            ? new(executable, [Path.GetFullPath(entry)])
            : new(executable, []);
    }
}

public sealed class ProcessEngineWorker(WorkerCommand command, long memoryLimitBytes = 512L * 1024 * 1024) : IEngineWorker
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaximumResultCharacters = 8 * 1024 * 1024;

    public async Task<EngineResponse> ExecuteAsync(ModelRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Diagnostic[] invalid = RequestValidation.Validate(request);
        if (invalid.Length > 0) return new(false, request.Operation, request.Dialect, null, invalid);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(request.TimeoutSeconds));
        CancellationToken token = deadline.Token;
        var start = new ProcessStartInfo(command.Executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        foreach (string argument in command.PrefixArguments) start.ArgumentList.Add(argument);
        start.ArgumentList.Add("--worker");
        using (Process owner = Process.GetCurrentProcess())
            start.Environment[WorkerLifetime.OwnerVariable] = $"{owner.Id}:{owner.StartTime.ToUniversalTime().Ticks}";
        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) throw new WorkerFailure("WORKER_START", "The model worker could not start.");
            Task<string> output = ReadLimitedAsync(process.StandardOutput, MaximumResultCharacters, token, () => Kill(process));
            Task<string> errors = ReadLimitedAsync(process.StandardError, 64 * 1024, token, () => Kill(process));
            Task memory = MonitorMemoryAsync(process, token);
            Task input = SendInputAsync(process, request, token);
            try
            {
                await Task.WhenAll(process.WaitForExitAsync(token), input, output, errors, memory);
            }
            catch
            {
                if (memory.IsFaulted) await memory;
                if (output.IsFaulted) await output;
                if (errors.IsFaulted) await errors;
                throw;
            }
            EngineResponse? response;
            try { response = JsonSerializer.Deserialize<EngineResponse>(await output, Json); }
            catch (JsonException) { throw new WorkerFailure("WORKER_PROTOCOL", "The model worker returned an invalid response."); }
            if (response is null || (process.ExitCode != 0 && response.Success))
                throw new WorkerFailure("WORKER_EXIT", "The model worker exited unexpectedly.");
            if (response.Operation != request.Operation || response.Dialect is not ("current" or "legacy") ||
                (request.Dialect != "auto" && response.Dialect != request.Dialect) || response.Diagnostics is null ||
                response.Diagnostics.Any(diagnostic => diagnostic is null || string.IsNullOrWhiteSpace(diagnostic.Code) || string.IsNullOrWhiteSpace(diagnostic.Message)) ||
                (response.Success ? response.Model is null || response.Diagnostics.Length != 0 : response.Model is not null || response.Diagnostics.Length == 0))
                throw new WorkerFailure("WORKER_PROTOCOL", "The model worker returned an inconsistent response.");
            return response;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new WorkerFailure("TIMEOUT", $"The model exceeded its {request.TimeoutSeconds}-second time limit.");
        }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new WorkerFailure("WORKER_START", "The model worker executable could not be started.");
        }
        catch (IOException)
        {
            throw new WorkerFailure("WORKER_EXIT", "The model worker closed its input or output unexpectedly.");
        }
        finally
        {
            Kill(process);
            try { if (process.Id > 0) await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
            catch (InvalidOperationException) { }
            catch (TimeoutException) { }
        }
    }

    private static async Task SendInputAsync(Process process, ModelRequest request, CancellationToken token)
    {
        await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request, Json).AsMemory(), token);
        process.StandardInput.Close();
    }

    private async Task MonitorMemoryAsync(Process process, CancellationToken token)
    {
        while (!process.HasExited)
        {
            long memory;
            try { process.Refresh(); memory = process.PrivateMemorySize64; }
            catch (InvalidOperationException) when (process.HasExited) { return; }
            catch (System.ComponentModel.Win32Exception) when (process.HasExited) { return; }
            if (memory > memoryLimitBytes)
            {
                Kill(process);
                throw new WorkerFailure("MEMORY_LIMIT", "The model exceeded its worker memory limit.");
            }
            await Task.Delay(100, token);
        }
    }

    private static async Task<string> ReadLimitedAsync(StreamReader reader, int limit, CancellationToken token, Action abort)
    {
        var result = new StringBuilder();
        char[] buffer = new char[4096];
        int count;
        while ((count = await reader.ReadAsync(buffer, token)) > 0)
        {
            if (result.Length + count > limit)
            {
                abort();
                throw new WorkerFailure("OUTPUT_LIMIT", "The model output exceeded the interactive result limit.");
            }
            result.Append(buffer, 0, count);
        }
        return result.ToString();
    }

    private static void Kill(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }
}


// A hard crash of the UI/CLI process must not leave its numerical worker running.
internal sealed class WorkerLifetime : IDisposable
{
    internal const string OwnerVariable = "VISUAL_DSD_WORKER_OWNER";
    private readonly ManualResetEvent stopped = new(false);
    private readonly Thread? monitor;

    public WorkerLifetime()
    {
        string? owner = Environment.GetEnvironmentVariable(OwnerVariable);
        if (owner is null) return;
        monitor = new Thread(() => Watch(owner)) { IsBackground = true, Name = "Worker owner monitor" };
        monitor.Start();
    }

    private void Watch(string owner)
    {
        try
        {
            string[] parts = owner.Split(':');
            if (parts.Length != 2 || !int.TryParse(parts[0], out int id) || !long.TryParse(parts[1], out long ticks)) { Environment.Exit(1); return; }
            using Process parent = Process.GetProcessById(id);
            if (parent.StartTime.ToUniversalTime().Ticks != ticks) { Environment.Exit(1); return; }
            while (!stopped.WaitOne(250)) if (parent.HasExited) { Environment.Exit(1); return; }
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        { Environment.Exit(1); }
    }

    public void Dispose()
    {
        stopped.Set();
        if (monitor is null || monitor.Join(1000)) stopped.Dispose();
    }
}
