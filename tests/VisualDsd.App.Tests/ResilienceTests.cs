using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

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
