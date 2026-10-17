using VisualDsd.Contracts;

namespace VisualDsd.App;

public sealed record JobAdmission(JobView? Job, Diagnostic[] Diagnostics, bool Busy = false);

public sealed class JobCoordinator : IAsyncDisposable
{
    private readonly object gate = new();
    private readonly Dictionary<string, Job> jobs = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim slots;
    private readonly IEngineWorker worker;
    private readonly int capacity;
    private bool stopping;

    private sealed class Job(string id, ModelRequest request)
    {
        public string Id { get; } = id;
        public ModelRequest Request { get; } = request;
        public CancellationTokenSource Cancellation { get; } = new();
        public DateTimeOffset Created { get; } = DateTimeOffset.UtcNow;
        public DateTimeOffset? Started { get; set; }
        public DateTimeOffset? Finished { get; set; }
        public string State { get; set; } = "queued";
        public EngineResponse? Result { get; set; }
        public bool CancellationRequested { get; set; }
        public Task Task { get; set; } = Task.CompletedTask;
        public bool Terminal => Finished.HasValue;
        public JobView View() => new(Id, State, Created, Started, Finished, Result);
    }

    public JobCoordinator(IEngineWorker worker, int parallelism = 2, int capacity = 32)
    {
        if (parallelism < 1 || capacity < parallelism) throw new ArgumentOutOfRangeException(nameof(capacity));
        this.worker = worker;
        this.capacity = capacity;
        slots = new SemaphoreSlim(parallelism);
    }

    public JobAdmission Enqueue(ModelRequest request)
    {
        Diagnostic[] validation = RequestValidation.Validate(request);
        if (validation.Length > 0) return new(null, validation);
        lock (gate)
        {
            if (stopping) return new(null, [new("SHUTTING_DOWN", "The application is shutting down.")], true);
            if (jobs.Count >= capacity)
            {
                Job? oldest = jobs.Values.Where(j => j.Terminal).MinBy(j => j.Finished);
                if (oldest is null) return new(null, [new("QUEUE_FULL", "The model queue is full. Try again after a job finishes.")], true);
                jobs.Remove(oldest.Id);
                oldest.Cancellation.Dispose();
            }
            // Admission owns the exact data that was validated, including every nested buffer.
            var snapshot = request with { Data = request.Data.Select(dataset => dataset with {
                Tables = dataset.Tables.Select(table => table with {
                    Times = (double[])table.Times.Clone(),
                    Series = table.Series.Select(column => column with { Values = (double[])column.Values.Clone() }).ToArray()
                }).ToArray()
            }).ToArray() };
            var job = new Job(Guid.NewGuid().ToString("N"), snapshot);
            jobs.Add(job.Id, job);
            job.Task = Task.Run(() => RunAsync(job));
            return new(job.View(), []);
        }
    }

    public JobView? Get(string id) { lock (gate) return jobs.GetValueOrDefault(id)?.View(); }
    public JobView[] List() { lock (gate) return jobs.Values.OrderByDescending(j => j.Created).Select(j => j.View() with { Result = null }).ToArray(); }

    public JobView? Cancel(string id)
    {
        Job? job;
        lock (gate)
        {
            job = jobs.GetValueOrDefault(id);
            if (job is null || job.Terminal) return job?.View();
            job.CancellationRequested = true;
            job.State = "cancelling";
        }
        try { job.Cancellation.Cancel(); } catch (ObjectDisposedException) { }
        return Get(id);
    }

    private async Task RunAsync(Job job)
    {
        bool acquired = false;
        string state;
        EngineResponse? result;
        try
        {
            await slots.WaitAsync(job.Cancellation.Token);
            acquired = true;
            lock (gate)
            {
                if (job.CancellationRequested) throw new OperationCanceledException();
                job.Started = DateTimeOffset.UtcNow;
                job.State = "running";
            }
            result = await worker.ExecuteAsync(job.Request, job.Cancellation.Token);
            state = result.Success ? "succeeded" : "failed";
        }
        catch (OperationCanceledException)
        {
            result = null;
            state = "cancelled";
        }
        catch (WorkerFailure error)
        {
            result = EngineResponse.Failure(job.Request, error.Code, error.Message);
            state = error.Code == "TIMEOUT" ? "timedOut" : "failed";
        }
        catch (Exception)
        {
            result = EngineResponse.Failure(job.Request, "WORKER_ERROR", "The model worker failed unexpectedly.");
            state = "failed";
        }
        finally { if (acquired) slots.Release(); }
        lock (gate)
        {
            job.Result = job.CancellationRequested ? null : result;
            job.State = job.CancellationRequested ? "cancelled" : state;
            job.Finished = DateTimeOffset.UtcNow;
        }
    }

    public async ValueTask DisposeAsync()
    {
        Job[] pending;
        lock (gate)
        {
            stopping = true;
            pending = jobs.Values.ToArray();
            foreach (Job job in pending.Where(j => !j.Terminal)) job.CancellationRequested = true;
        }
        foreach (Job job in pending) { try { job.Cancellation.Cancel(); } catch (ObjectDisposedException) { } }
        await Task.WhenAll(pending.Select(j => j.Task));
        foreach (Job job in pending) job.Cancellation.Dispose();
        slots.Dispose();
    }
}
