using System.Threading.Channels;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

public class JobTests
{
    private sealed class ControlledWorker : IEngineWorker
    {
        public Channel<TaskCompletionSource<EngineResponse>> Calls { get; } = Channel.CreateUnbounded<TaskCompletionSource<EngineResponse>>();
        public int CallCount;
        public async Task<EngineResponse> ExecuteAsync(ModelRequest request, CancellationToken token)
        {
            Interlocked.Increment(ref CallCount);
            var completion = new TaskCompletionSource<EngineResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            await Calls.Writer.WriteAsync(completion, token);
            return await completion.Task.WaitAsync(token);
        }
        public Task<TaskCompletionSource<EngineResponse>> Next() => Calls.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
    }

    private static ModelRequest Request => new() { Code = "<a>" };

    internal static async Task<JobView> FinishedAsync(JobCoordinator jobs, string id)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            JobView job = jobs.Get(id)!;
            if (job.FinishedAt.HasValue) return job;
            await Task.Delay(10, deadline.Token);
        }
    }

    [Fact]
    public async Task Queued_cancellation_does_not_execute_the_worker()
    {
        var worker = new ControlledWorker();
        await using var jobs = new JobCoordinator(worker, parallelism: 1, capacity: 2);
        JobView first = jobs.Enqueue(Request).Job!;
        await worker.Next();
        JobView second = jobs.Enqueue(Request).Job!;
        Assert.Equal("queued", jobs.Get(second.Id)!.State);
        jobs.Cancel(second.Id);
        Assert.Equal("cancelled", (await FinishedAsync(jobs, second.Id)).State);
        Assert.Equal(1, worker.CallCount);
        jobs.Cancel(first.Id);
        Assert.Equal("cancelled", (await FinishedAsync(jobs, first.Id)).State);
    }

    [Fact]
    public async Task Active_jobs_are_bounded_and_completed_results_can_be_evicted()
    {
        var worker = new ControlledWorker();
        await using var jobs = new JobCoordinator(worker, parallelism: 1, capacity: 2);
        JobView first = jobs.Enqueue(Request).Job!;
        TaskCompletionSource<EngineResponse> running = await worker.Next();
        JobView second = jobs.Enqueue(Request).Job!;
        JobAdmission refused = jobs.Enqueue(Request);
        Assert.Null(refused.Job);
        Assert.True(refused.Busy);
        running.SetResult(new(true, "parse", "current", null, []));
        Assert.Equal("succeeded", (await FinishedAsync(jobs, first.Id)).State);
        await worker.Next();
        Assert.NotNull(jobs.Enqueue(Request).Job);
        Assert.Null(jobs.Get(first.Id));
        jobs.Cancel(second.Id);
    }

    [Fact]
    public async Task Concurrent_jobs_do_not_share_results()
    {
        var worker = new ControlledWorker();
        await using var jobs = new JobCoordinator(worker, parallelism: 2);
        JobView first = jobs.Enqueue(Request).Job!;
        TaskCompletionSource<EngineResponse> a = await worker.Next();
        JobView second = jobs.Enqueue(Request with { Code = "<b>" }).Job!;
        TaskCompletionSource<EngineResponse> b = await worker.Next();
        a.SetResult(new(true, "parse", "current", null, [new("FIRST", "a")]));
        b.SetResult(new(true, "parse", "current", null, [new("SECOND", "b")]));
        Assert.Equal("FIRST", Assert.Single((await FinishedAsync(jobs, first.Id)).Result!.Diagnostics).Code);
        Assert.Equal("SECOND", Assert.Single((await FinishedAsync(jobs, second.Id)).Result!.Diagnostics).Code);
        Assert.All(jobs.List(), job => Assert.Null(job.Result));
    }

    [Fact]
    public async Task Invalid_requests_do_not_reach_a_worker()
    {
        var worker = new ControlledWorker();
        await using var jobs = new JobCoordinator(worker);
        Assert.Null(jobs.Enqueue(Request with { Code = "" }).Job);
        Assert.Equal(0, worker.CallCount);
    }
}
