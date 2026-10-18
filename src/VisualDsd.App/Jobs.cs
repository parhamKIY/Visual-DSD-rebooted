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
    private readonly JobStore? store;
    private readonly string? engineVersion;

    private sealed class Job(string id, ModelRequest request)
    {
        public string Id { get; } = id;
        public ModelRequest Request { get; } = request;
        public CancellationTokenSource Cancellation { get; set; } = new();
        public DateTimeOffset Created { get; set; } = DateTimeOffset.UtcNow;
        public DateTimeOffset? Started { get; set; }
        public DateTimeOffset? Finished { get; set; }
        public string State { get; set; } = "queued";
        public EngineResponse? Result { get; set; }
        public string? EngineVersion { get; set; }
        public EngineProgress? Progress { get; set; }
        public long Revision { get; set; }
        public string? RemoteId { get; set; }
        public bool RecoverCancellation { get; set; }
        public bool CancellationRequested { get; set; }
        public Task Task { get; set; } = Task.CompletedTask;
        public bool Terminal => Finished.HasValue;
        public JobView View() => new(Id, State, Created, Started, Finished, Result,Progress,Revision,RemoteId,EngineVersion);
    }

    public JobCoordinator(IEngineWorker worker, int parallelism = 2, int capacity = 32, JobStore? store = null,string? engineVersion = null)
    {
        if (parallelism < 1 || capacity < parallelism) throw new ArgumentOutOfRangeException(nameof(capacity));
        this.worker = worker;
        this.capacity = capacity;
        slots = new SemaphoreSlim(parallelism);
        this.store=store;this.engineVersion=engineVersion;
        if(store is not null)foreach(var entry in store.Load(capacity))
        {
            var view=entry.View;var job=new Job(view.Id,entry.Request){Created=view.CreatedAt,Started=view.StartedAt,Finished=view.FinishedAt,State=view.State,Result=view.Result,Progress=view.Progress,Revision=view.Revision+1,RemoteId=view.RemoteId,EngineVersion=view.EngineVersion,RecoverCancellation=view.State=="cancelling"};
            jobs.Add(job.Id,job);
            if(!job.Terminal && !(job.RemoteId is not null && worker is RemoteEngineWorker))
            {
                job.Finished=DateTimeOffset.UtcNow;job.State="interrupted";job.Result=EngineResponse.Failure(job.Request,"SERVER_RESTART","The service stopped before this calculation finished. It was not automatically rerun.");store.Save(new(job.Request,job.View()));
            }
        }
        foreach(var job in jobs.Values.Where(j=>!j.Terminal))job.Task=Task.Run(()=>RunAsync(job));
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
                Job? oldest = jobs.Values.Where(j => j.Terminal && !(j.RemoteId is not null && j.Result?.Diagnostics.Any(d=>d.Code is "REMOTE_CONNECTION" or "REMOTE_CANCEL_UNKNOWN" or "REMOTE_PROTOCOL" or "REMOTE_VERSION" or "STORAGE_ERROR" or "WORKER_ERROR")==true)).MinBy(j => j.Finished);
                if (oldest is null) return new(null, [new("QUEUE_FULL", "The model queue is full. Try again after a job finishes.")], true);
                store?.Delete(oldest.Id);
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
            var job = new Job(Guid.NewGuid().ToString("N"), snapshot){EngineVersion=engineVersion};
            store?.Save(new(job.Request,job.View()));
            jobs.Add(job.Id, job);
            job.Task = Task.Run(() => RunAsync(job));
            return new(job.View(), []);
        }
    }

    public ModelRequest? Input(string id) { lock(gate)return jobs.GetValueOrDefault(id)?.Request; }
    public JobView? Get(string id) { lock (gate) return jobs.GetValueOrDefault(id)?.View(); }
    public JobView[] List() { lock (gate) return jobs.Values.OrderByDescending(j => j.Created).Select(j => j.View() with { Result = null, Progress = j.Progress is null?null:j.Progress with{Preview=null} }).ToArray(); }

    public JobView? Resume(string id)
    {
        lock(gate)
        {
            var job=jobs.GetValueOrDefault(id);
            if(job is null)return null;
            if(!job.Terminal || job.RemoteId is null || worker is not RemoteEngineWorker || job.State!="failed")return job.View();
            job.Cancellation.Dispose();job.Cancellation=new();job.CancellationRequested=false;
            job.Result=null;job.State="queued";job.Finished=null;job.Started=null;job.Revision++;
            store?.Save(new(job.Request,job.View()));job.Task=Task.Run(()=>RunAsync(job));return job.View();
        }
    }

    public JobView? Cancel(string id)
    {
        Job? job;
        lock (gate)
        {
            job = jobs.GetValueOrDefault(id);
            if (job is null || job.Terminal) return job?.View();
            job.CancellationRequested = true;
            job.State = "cancelling";job.Revision++;
            store?.Save(new(job.Request,job.View()));
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
                job.State = job.RecoverCancellation?"cancelling":"running";job.Revision++;
                store?.Save(new(job.Request,job.View()));
            }
            void Progress(EngineProgress progress)
            {
                lock(gate)
                {
                    if(job.Terminal || job.CancellationRequested)return;
                    job.Progress=progress;job.Revision++;
                    if(progress.RemoteId is not null && job.RemoteId!=progress.RemoteId){job.RemoteId=progress.RemoteId;store?.Save(new(job.Request,job.View()));}
                }
            }
            if(job.RecoverCancellation)job.Cancellation.Cancel();
            result = job.RemoteId is not null && worker is RemoteEngineWorker remote
                ? await remote.ResumeAsync(job.Request,job.RemoteId,Progress,job.Cancellation.Token)
                : await worker.ExecuteAsync(job.Request,Progress,job.Cancellation.Token);
            state = result.Success ? "succeeded" : result.Diagnostics.Any(d=>d.Code=="TIMEOUT")?"timedOut":"failed";
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
            bool cancelled=job.CancellationRequested && result?.Diagnostics.Any(d=>d.Code is "REMOTE_CANCEL_UNKNOWN" or "REMOTE_SUBMISSION_UNKNOWN")!=true;
            job.Result = cancelled ? null : result;
            job.State = cancelled ? "cancelled" : state;
            job.Finished = DateTimeOffset.UtcNow;job.Revision++;
            try{store?.Save(new(job.Request,job.View()));}
            catch(IOException){job.Result=EngineResponse.Failure(job.Request,"STORAGE_ERROR","The completed result could not be saved to the job directory.");job.State="failed";}
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
        store?.Dispose();
    }
}
