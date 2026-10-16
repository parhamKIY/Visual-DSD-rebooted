using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

public sealed class LocalHost : IAsyncLifetime
{
    private Process? process;
    private Task? stdout;
    private Task? stderr;
    public HttpClient Client { get; private set; } = null!;
    public static string Root
    {
        get
        {
            DirectoryInfo? directory = new(AppContext.BaseDirectory);
            while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "VisualDsd.Rebooted.slnx"))) directory = directory.Parent;
            return directory?.FullName ?? throw new InvalidOperationException("Repository root not found.");
        }
    }
    public static WorkerCommand Command => new(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet",
        [Path.Combine(Root, "src", "VisualDsd.App", "bin", "Release", "net10.0", "VisualDsd.dll")]);

    public async Task InitializeAsync()
    {
        WorkerCommand command = Command;
        var start = new ProcessStartInfo(command.Executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string argument in command.PrefixArguments) start.ArgumentList.Add(argument);
        start.ArgumentList.Add("serve"); start.ArgumentList.Add("--port"); start.ArgumentList.Add("0");
        process = Process.Start(start)!;
        var address = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        stdout = Task.Run(async () =>
        {
            while (await process.StandardOutput.ReadLineAsync() is { } line)
            {
                Match match = Regex.Match(line, @"Now listening on: (http://127\.0\.0\.1:\d+)");
                if (match.Success) address.TrySetResult(match.Groups[1].Value);
            }
        });
        stderr = process.StandardError.ReadToEndAsync();
        try { Client = new HttpClient { BaseAddress = new Uri(await address.Task.WaitAsync(TimeSpan.FromSeconds(15))) }; }
        catch { process.Kill(entireProcessTree: true); throw; }
    }

    public async Task DisposeAsync()
    {
        Client?.Dispose();
        if (process is not null)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            await Task.WhenAll(stdout!, stderr!);
            process.Dispose();
        }
    }

    public async Task<JobView> FinishAsync(string id)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (true)
        {
            JobView job = (await Client.GetFromJsonAsync<JobView>($"/api/jobs/{id}", deadline.Token))!;
            if (job.FinishedAt.HasValue) return job;
            await Task.Delay(25, deadline.Token);
        }
    }
}

public class ApiTests(LocalHost host) : IClassFixture<LocalHost>
{
    [Fact]
    public async Task Real_worker_expands_models_through_the_local_API()
    {
        HttpResponseMessage accepted = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest { Code = EngineTests.Catalytic, Operation = "expand" });
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        JobView created = (await accepted.Content.ReadFromJsonAsync<JobView>())!;
        JobView completed = await host.FinishAsync(created.Id);
        Assert.Equal("succeeded", completed.State);
        Assert.Equal(9, completed.Result!.Model!.Species.Length);
        Assert.Equal(4, completed.Result.Model.Reactions.Length);
        Assert.True((await host.Client.GetAsync("/health")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Invalid_and_cross_origin_requests_are_rejected()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest { Code = "" })).StatusCode);
        using var crossOrigin = new HttpRequestMessage(HttpMethod.Post, "/api/jobs") { Content = JsonContent.Create(new ModelRequest { Code = "<a>" }) };
        crossOrigin.Headers.Add("Origin", "https://example.com");
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client.SendAsync(crossOrigin)).StatusCode);
        using var rebinding = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        rebinding.Headers.Host = "example.com";
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.SendAsync(rebinding)).StatusCode);
        using var unknown = new StringContent("{\"code\":\"<a>\",\"typo\":true}", Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.PostAsync("/api/jobs", unknown)).StatusCode);
    }

    [Fact]
    public async Task Model_failures_keep_the_service_available()
    {
        HttpResponseMessage response = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest { Code = "<a^" });
        JobView job = (await response.Content.ReadFromJsonAsync<JobView>())!;
        JobView completed = await host.FinishAsync(job.Id);
        Assert.Equal("failed", completed.State);
        Assert.Contains(completed.Result!.Diagnostics, error => error.Code == "PARSE_ERROR");
        Assert.True((await host.Client.GetAsync("/health")).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client.GetAsync("/api/jobs/nonexistent")).StatusCode);
    }

    [Fact]
    public async Task API_reports_a_worker_timeout_and_remains_responsive()
    {
        HttpResponseMessage response = await host.Client.PostAsJsonAsync("/api/jobs", WorkerTests.SlowRequest);
        JobView created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        JobView finished = await host.FinishAsync(created.Id);
        Assert.Equal("timedOut", finished.State);
        Assert.Equal("TIMEOUT", Assert.Single(finished.Result!.Diagnostics).Code);
        Assert.True((await host.Client.GetAsync("/health")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task API_cancellation_terminates_the_active_model()
    {
        HttpResponseMessage response = await host.Client.PostAsJsonAsync("/api/jobs", WorkerTests.SlowRequest with { TimeoutSeconds = 30 });
        JobView created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while ((await host.Client.GetFromJsonAsync<JobView>($"/api/jobs/{created.Id}", deadline.Token))!.State == "queued") await Task.Delay(20, deadline.Token);
        Assert.Equal(HttpStatusCode.Accepted, (await host.Client.DeleteAsync($"/api/jobs/{created.Id}")).StatusCode);
        JobView finished = await host.FinishAsync(created.Id);
        Assert.Equal("cancelled", finished.State);
        Assert.Null(finished.Result);
    }
}

public class WorkerTests
{
    internal static ModelRequest SlowRequest => new()
    {
        Code = "directive simulator stochastic\n(1000 * <a> | rxn <a> ->{1.0} <a>)",
        Operation = "simulate", Final = 1e12, Points = 1, Seed = 42, TimeoutSeconds = 1
    };

    [Fact]
    public async Task Actual_worker_deadlines_terminate_computation()
    {
        var worker = new ProcessEngineWorker(LocalHost.Command);
        var stopwatch = Stopwatch.StartNew();
        WorkerFailure failure = await Assert.ThrowsAsync<WorkerFailure>(() => worker.ExecuteAsync(SlowRequest, CancellationToken.None));
        Assert.Equal("TIMEOUT", failure.Code);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(8));
    }

    [Fact]
    public async Task Actual_worker_cancellation_stops_active_computation()
    {
        var worker = new ProcessEngineWorker(LocalHost.Command);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => worker.ExecuteAsync(SlowRequest with { TimeoutSeconds = 30 }, cancellation.Token));
    }

    [Fact]
    public async Task Worker_memory_budget_is_enforced()
    {
        var worker = new ProcessEngineWorker(LocalHost.Command, memoryLimitBytes: 1);
        WorkerFailure error = await Assert.ThrowsAsync<WorkerFailure>(() => worker.ExecuteAsync(new() { Code = "<a>" }, CancellationToken.None));
        Assert.Equal("MEMORY_LIMIT", error.Code);
    }

    [Fact]
    public async Task CLI_runs_from_a_directory_containing_spaces()
    {
        WorkerCommand command = LocalHost.Command;
        var start = new ProcessStartInfo(command.Executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string argument in command.PrefixArguments) start.ArgumentList.Add(argument);
        start.ArgumentList.Add("expand");
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "fixtures", "Catalytic.txt"));
        using Process process = Process.Start(start)!;
        Task<string> output = process.StandardOutput.ReadToEndAsync();
        Task<string> errors = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(0, process.ExitCode);
        EngineResponse response = JsonSerializer.Deserialize<EngineResponse>(await output, ProcessEngineWorker.Json)!;
        Assert.True(response.Success, await errors);
        Assert.Equal(4, response.Model!.Reactions.Length);
    }
}
