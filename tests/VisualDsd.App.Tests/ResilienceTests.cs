using System.Diagnostics;
using System.Text.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

[Collection("Process integration")]
public class ResilienceTests
{
    private static ProcessEngineWorker Probe => new(new(LocalHost.Command.Executable,
        [Path.Combine(LocalHost.Root, "tests", "VisualDsd.WorkerProbe", "bin", "Release", "net10.0", "VisualDsd.WorkerProbe.dll")]));

    [Theory]
    [InlineData("malformed", "WORKER_PROTOCOL")]
    [InlineData("incomplete", "WORKER_PROTOCOL")]
    [InlineData("empty", "WORKER_PROTOCOL")]
    [InlineData("missing-model", "WORKER_PROTOCOL")]
    [InlineData("missing-diagnostics", "WORKER_PROTOCOL")]
    [InlineData("false-success", "WORKER_PROTOCOL")]
    [InlineData("empty-failure", "WORKER_PROTOCOL")]
    [InlineData("failure-with-model", "WORKER_PROTOCOL")]
    [InlineData("wrong-operation", "WORKER_PROTOCOL")]
    [InlineData("wrong-dialect", "WORKER_PROTOCOL")]
    [InlineData("bad-exit", "WORKER_EXIT")]
    [InlineData("oversized-output", "OUTPUT_LIMIT")]
    [InlineData("oversized-errors", "OUTPUT_LIMIT")]
    public async Task Broken_worker_output_is_rejected_and_the_next_request_still_completes(string scenario, string code)
    {
        await using var jobs = new JobCoordinator(Probe, parallelism: 1, capacity: 2);
        var bad = jobs.Enqueue(new() { Code = scenario, Dialect = "current" }).Job!;
        var good = jobs.Enqueue(new() { Code = "success" }).Job!;
        var failed = await JobTests.FinishedAsync(jobs, bad.Id);
        Assert.Equal("failed", failed.State); Assert.Null(failed.Result!.Model);
        Assert.Equal(code, Assert.Single(failed.Result.Diagnostics).Code);
        Assert.Equal("succeeded", (await JobTests.FinishedAsync(jobs, good.Id)).State);
    }

    [Fact]
    public async Task A_worker_stops_if_its_owner_process_disappears_during_computation()
    {
        string marker = Path.Combine(Path.GetTempPath(), "visual-dsd-owner-" + Guid.NewGuid().ToString("N"));
        var ownerStart = new ProcessStartInfo(LocalHost.Command.Executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        ownerStart.ArgumentList.Add(Path.Combine(LocalHost.Root, "tests", "VisualDsd.WorkerProbe", "bin", "Release", "net10.0", "VisualDsd.WorkerProbe.dll"));
        ownerStart.ArgumentList.Add("--owner"); ownerStart.ArgumentList.Add(LocalHost.Command.PrefixArguments[0]); ownerStart.ArgumentList.Add(marker);
        using var owner = Process.Start(ownerStart)!;
        var output = owner.StandardOutput.ReadToEndAsync(); var errors = owner.StandardError.ReadToEndAsync();
        Process? worker = null;
        try
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            while (!File.Exists(marker)) { Assert.False(owner.HasExited, await ReadErrorIfExited()); await Task.Delay(25, deadline.Token); }
            worker = Process.GetProcessById(int.Parse(await File.ReadAllTextAsync(marker)));
            Assert.False(worker.HasExited);
            // Kill only the owner; killing its tree would conceal a broken ownership monitor.
            owner.Kill(); await owner.WaitForExitAsync();
            await worker.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.NotEqual(0, worker.ExitCode);
        }
        finally
        {
            if (!owner.HasExited) owner.Kill(entireProcessTree: true);
            if (worker is not null && !worker.HasExited) worker.Kill(entireProcessTree: true);
            await owner.WaitForExitAsync(); if (worker is not null) { await worker.WaitForExitAsync(); worker.Dispose(); }
            await Task.WhenAll(output, errors);
            File.Delete(marker); File.Delete(marker + ".pending");
        }
        async Task<string> ReadErrorIfExited() => owner.HasExited ? await errors : "";
    }

    [Fact]
    public async Task A_valid_model_failure_retains_its_diagnostic()
    {
        var response = await Probe.ExecuteAsync(new() { Code = "valid-failure" }, CancellationToken.None);
        Assert.False(response.Success); Assert.Null(response.Model); Assert.Equal("MODEL_ERROR", Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public async Task Cancelled_requests_do_not_launch_another_process()
    {
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        var missing = new ProcessEngineWorker(new(Path.Combine(LocalHost.Root, "missing-worker"), []));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => missing.ExecuteAsync(new() { Code = "<a>" }, cancellation.Token));
    }
}
