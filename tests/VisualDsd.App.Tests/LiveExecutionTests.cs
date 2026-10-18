using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine=VisualDsd.Engine.Engine;
namespace VisualDsd.Tests;

public class LiveEngineTests
{
    [Theory]
    [InlineData("oslo")]
    [InlineData("ssa")]
    [InlineData("sundials")]
    public void Observed_runs_match_unobserved_sweeps_and_named_simulations(string simulator)
    {
        const string code="directive parameters [N=3]\ndirective sweeps [dose=[N=[3;7]]]\ndirective simulations [short={initial=2;final=3;points=8;seed=42};long={initial=2;final=4;points=8;seed=43}]\n(N * <a> | rxn <a> ->{0.4} <b>)";
        var request=new ModelRequest{Code=code,Operation="simulate",Simulator=simulator};
        var plain=CoreEngine.Execute(request);var progress=new List<EngineProgress>();EngineResponse observed;
        using(EngineTelemetry.Begin(progress.Add))observed=CoreEngine.Execute(request);
        Assert.True(observed.Success,JsonSerializer.Serialize(observed));Assert.Equal(JsonSerializer.Serialize(plain),JsonSerializer.Serialize(observed));
        Assert.All(progress,p=>Assert.True(p.IsValid()));if(simulator!="sundials")Assert.Contains(progress,p=>p.Preview?.Times.Length>0);
    }
    [Fact]
    public void JIT_runs_keep_explicit_DSD_overrides_and_observation_does_not_change_seeded_results()
    {
        var request=new ModelRequest{Code="directive jit\ndirective simulator stochastic\n(<a^ b> | {a^*}[b])",Operation="simulate",Seed=42,Final=2,Points=4,DsdOptions=new(){ToeholdBindRate=.03,ToeholdUnbindRate=.2,Renderer="branches"}};
        var plain=CoreEngine.Execute(request);var progress=new List<EngineProgress>();EngineResponse observed;
        using(EngineTelemetry.Begin(progress.Add))observed=CoreEngine.Execute(request);
        Assert.True(observed.Success,JsonSerializer.Serialize(observed));Assert.Equal(JsonSerializer.Serialize(plain),JsonSerializer.Serialize(observed));
        Assert.Contains(observed.Model!.Reactions,r=>r.Rate.Expression.Contains("0.03"));Assert.Contains(progress,p=>p.Phase=="simulating");
    }
    [Fact]
    public void Long_deadlines_are_bounded_and_new_metadata_rejects_nonfinite_and_oversized_previews()
    {
        Assert.Empty(RequestValidation.Validate(new(){Code="<a>",TimeoutSeconds=86400}));
        Assert.Contains(RequestValidation.Validate(new(){Code="<a>",TimeoutSeconds=86401}),d=>d.Code=="INVALID_TIMEOUT");
        Assert.False(new EngineProgress("simulating","test",Time:double.NaN).IsValid());Assert.False(new EngineProgress("simulating","test",Completed:2,Total:1).IsValid());
        Assert.False(new EngineProgress("simulating","test",Preview:new([0],[new("A",[double.PositiveInfinity])])).IsValid());
        Assert.False(new EngineProgress("simulating","test",Preview:new(new double[201],[])).IsValid());Assert.False(new EngineProgress("fake","test").IsValid());
    }
}

public class DurableJobTests
{
    private sealed class Unconfirmed(string code):IEngineWorker
    {
        public TaskCompletionSource<bool> Started=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<EngineResponse> ExecuteAsync(ModelRequest request,CancellationToken token)
        {
            Started.TrySetResult(true);
            try{await Task.Delay(Timeout.Infinite,token);}
            catch(OperationCanceledException){throw new WorkerFailure(code,"The remote outcome could not be confirmed.");}
            throw new InvalidOperationException();
        }
    }
    [Theory]
    [InlineData("REMOTE_CANCEL_UNKNOWN")]
    [InlineData("REMOTE_SUBMISSION_UNKNOWN")]
    public async Task Cancellation_cannot_hide_an_unconfirmed_remote_outcome(string code)
    {
        var worker=new Unconfirmed(code);await using var jobs=new JobCoordinator(worker);var job=jobs.Enqueue(new(){Code="<a>"}).Job!;
        await worker.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));jobs.Cancel(job.Id);var result=await JobTests.FinishedAsync(jobs,job.Id);
        Assert.Equal("failed",result.State);Assert.Equal(code,result.Result!.Diagnostics[0].Code);
    }
    private sealed class Worker:IEngineWorker
    {
        public int Calls;
        public Task<EngineResponse> ExecuteAsync(ModelRequest request,CancellationToken token){Calls++;return Task.FromResult(CoreEngine.Execute(request));}
    }
    [Fact]
    public async Task Completed_results_and_inputs_survive_reopening_and_eviction_removes_the_old_disk_record()
    {
        string path=Path.Combine(Path.GetTempPath(),"visual-dsd-jobs-"+Guid.NewGuid().ToString("N"));string id;
        try
        {
            await using(var jobs=new JobCoordinator(new Worker(),1,1,new JobStore(path)))
            {id=jobs.Enqueue(new(){Code="<a>"}).Job!.Id;Assert.Equal("succeeded",(await JobTests.FinishedAsync(jobs,id)).State);}
            await using(var jobs=new JobCoordinator(new Worker(),1,1,new JobStore(path)))
            {Assert.True(jobs.Get(id)!.Result!.Success);Assert.Equal("<a>",jobs.Input(id)!.Code);var next=jobs.Enqueue(new(){Code="<b>"}).Job!;await JobTests.FinishedAsync(jobs,next.Id);Assert.False(File.Exists(Path.Combine(path,id+".json")));}
        }
        finally{Clean(path);}
    }
    [Fact]
    public async Task Interrupted_local_jobs_are_not_silently_rerun_and_a_directory_has_one_owner()
    {
        string path=Path.Combine(Path.GetTempPath(),"visual-dsd-jobs-"+Guid.NewGuid().ToString("N")),id=Guid.NewGuid().ToString("N");var worker=new Worker();
        try
        {
            using(var store=new JobStore(path))
            {Assert.Throws<IOException>(()=>new JobStore(path));store.Save(new(new(){Code="<a>"},new(id,"running",DateTimeOffset.UtcNow,DateTimeOffset.UtcNow,null,null)));}
            await using var jobs=new JobCoordinator(worker,store:new JobStore(path));
            Assert.Equal("interrupted",jobs.Get(id)!.State);Assert.Equal("SERVER_RESTART",jobs.Get(id)!.Result!.Diagnostics[0].Code);Assert.Equal(0,worker.Calls);
        }
        finally{Clean(path);}
    }
    internal static void Clean(string path){if(Directory.Exists(path)){foreach(string file in Directory.GetFiles(path))File.Delete(file);Directory.Delete(path);}}
}

[Collection("Process integration")]
public class LiveWorkerTests(LocalHost host):IClassFixture<LocalHost>
{
    [Fact]
    public async Task Actual_worker_reports_preview_before_completion_and_cancellation_remains_effective()
    {
        var worker=new ProcessEngineWorker(LocalHost.Command);using var stop=new CancellationTokenSource();var preview=new TaskCompletionSource<EngineProgress>(TaskCreationOptions.RunContinuationsAsynchronously);
        var task=worker.ExecuteAsync(WorkerTests.SlowRequest with{Points=100,TimeoutSeconds=600},p=>{if(p.Preview?.Times.Length>0)preview.TrySetResult(p);},stop.Token);
        try{Assert.NotNull((await preview.Task.WaitAsync(TimeSpan.FromSeconds(10))).Preview);Assert.False(task.IsCompleted);}finally{stop.Cancel();}
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>task);
    }
    [Fact]
    public async Task SSE_disconnect_does_not_cancel_a_job_and_reconnection_returns_a_terminal_snapshot()
    {
        var admitted=await host.Client.PostAsJsonAsync("/api/jobs",WorkerTests.SlowRequest with{TimeoutSeconds=30});var job=(await admitted.Content.ReadFromJsonAsync<JobView>())!;
        using(var stop=new CancellationTokenSource(TimeSpan.FromSeconds(10)))
        using(var response=await host.Client.GetAsync($"/api/jobs/{job.Id}/events",HttpCompletionOption.ResponseHeadersRead,stop.Token))
        {
            Assert.Equal("text/event-stream",response.Content.Headers.ContentType!.MediaType);using var stream=await response.Content.ReadAsStreamAsync(stop.Token);using var reader=new StreamReader(stream);
            string? line;do{line=await reader.ReadLineAsync(stop.Token);}while(line is not null&&!line.StartsWith("data: "));
            Assert.NotNull(line);Assert.Equal(job.Id,JsonSerializer.Deserialize<JobView>(line![6..],ProcessEngineWorker.Json)!.Id);
        }
        Assert.Null((await host.Client.GetFromJsonAsync<JobView>($"/api/jobs/{job.Id}"))!.FinishedAt);await host.Client.DeleteAsync($"/api/jobs/{job.Id}");Assert.Equal("cancelled",(await host.FinishAsync(job.Id)).State);
        string terminal=await host.Client.GetStringAsync($"/api/jobs/{job.Id}/events");Assert.Contains("\"state\":\"cancelled\"",terminal);
        Assert.Equal(WorkerTests.SlowRequest.Code,(await host.Client.GetFromJsonAsync<ModelRequest>($"/api/jobs/{job.Id}/input"))!.Code);
    }
}

internal sealed class ComputeService:IAsyncDisposable
{
    public string Token{get;}=Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    public string DirectoryPath{get;}=Path.Combine(Path.GetTempPath(),"visual-dsd-compute-"+Guid.NewGuid().ToString("N"));
    private Process? process;private Task? output,errors;
    public Uri Address{get;private set;}=null!;public HttpClient Client{get;private set;}=null!;
    public async Task StartAsync()
    {
        var command=LocalHost.Command;var start=new ProcessStartInfo(command.Executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        foreach(var arg in command.PrefixArguments)start.ArgumentList.Add(arg);foreach(var arg in new[]{"compute","--port","0","--jobs-dir",DirectoryPath})start.ArgumentList.Add(arg);
        start.Environment["VISUAL_DSD_COMPUTE_TOKEN"]=Token;process=Process.Start(start)!;var ready=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        output=Task.Run(async()=>{while(await process.StandardOutput.ReadLineAsync() is {} line){const string prefix="Now listening on: ";int i=line.IndexOf(prefix,StringComparison.Ordinal);if(i>=0)ready.TrySetResult(line[(i+prefix.Length)..]);}});
        errors=process.StandardError.ReadToEndAsync();Address=new Uri(await ready.Task.WaitAsync(TimeSpan.FromSeconds(15)));Client=new(){BaseAddress=Address};Client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",Token);
    }
    public async Task StopAsync(){Client?.Dispose();if(process is null)return;if(!process.HasExited)process.Kill();await process.WaitForExitAsync();await Task.WhenAll(output!,errors!);process.Dispose();process=null;}
    public async ValueTask DisposeAsync(){await StopAsync();DurableJobTests.Clean(DirectoryPath);}
}

[Collection("Process integration")]
public class RemoteWorkerTests
{
    [Fact]
    public async Task Authenticated_compute_matches_the_local_engine_and_secrets_are_not_persisted()
    {
        await using var service=new ComputeService();await service.StartAsync();using var anonymous=new HttpClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(new Uri(service.Address,"api/info"))).StatusCode);
        using var remote=new RemoteEngineWorker(service.Address,service.Token,CoreEngine.Info.Version);var request=new ModelRequest{Code="(<a^ b> | {a^*}[b])",Operation="simulate",Final=2,Points=4,Seed=42,Simulator="oslo"};var updates=new List<EngineProgress>();
        var result=await remote.ExecuteAsync(request,updates.Add,CancellationToken.None);Assert.Equal(JsonSerializer.Serialize(CoreEngine.Execute(request)),JsonSerializer.Serialize(result));Assert.Contains(updates,p=>p.RemoteId?.Length==32);
        Assert.All(Directory.GetFiles(service.DirectoryPath,"*.json"),file=>Assert.DoesNotContain(service.Token,File.ReadAllText(file)));
        using var wrong=new RemoteEngineWorker(service.Address,new string('x',32),CoreEngine.Info.Version);Assert.Equal("REMOTE_AUTH",(await Assert.ThrowsAsync<WorkerFailure>(()=>wrong.ExecuteAsync(request,CancellationToken.None))).Code);
        using var mismatch=new RemoteEngineWorker(service.Address,service.Token,"0.0.0");Assert.Equal("REMOTE_VERSION",(await Assert.ThrowsAsync<WorkerFailure>(()=>mismatch.ExecuteAsync(request,CancellationToken.None))).Code);
    }
    [Fact]
    public async Task Remote_cancellation_is_confirmed_and_service_restart_does_not_resubmit_local_work()
    {
        await using var service=new ComputeService();await service.StartAsync();using var remote=new RemoteEngineWorker(service.Address,service.Token,CoreEngine.Info.Version);using var stop=new CancellationTokenSource();var admitted=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var running=remote.ExecuteAsync(WorkerTests.SlowRequest with{TimeoutSeconds=600},p=>{if(p.RemoteId is not null)admitted.TrySetResult(p.RemoteId);},stop.Token);string id=await admitted.Task.WaitAsync(TimeSpan.FromSeconds(10));stop.Cancel();await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>running);
        Assert.Equal("cancelled",(await service.Client.GetFromJsonAsync<JobView>($"api/jobs/{id}"))!.State);
        var response=await service.Client.PostAsJsonAsync("api/jobs",WorkerTests.SlowRequest with{TimeoutSeconds=600});var job=(await response.Content.ReadFromJsonAsync<JobView>())!;await service.StopAsync();await service.StartAsync();var recovered=(await service.Client.GetFromJsonAsync<JobView>($"api/jobs/{job.Id}"))!;
        Assert.Equal("interrupted",recovered.State);Assert.Equal("SERVER_RESTART",recovered.Result!.Diagnostics[0].Code);
    }
    private sealed class LostResponse:HttpMessageHandler
    {
        public int Posts;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){if(request.Method==HttpMethod.Post){Posts++;throw new HttpRequestException("Lost response");}return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(CoreEngine.Info)});}
    }
    [Fact]
    public async Task Recovering_a_known_remote_identifier_does_not_submit_a_second_job()
    {
        await using var service=new ComputeService();await service.StartAsync();
        var request=new ModelRequest{Code="<a>",Dialect="current"};
        var accepted=await service.Client.PostAsJsonAsync("api/jobs",request);var remoteJob=(await accepted.Content.ReadFromJsonAsync<JobView>())!;
        string path=Path.Combine(Path.GetTempPath(),"visual-dsd-resume-"+Guid.NewGuid().ToString("N")),id=Guid.NewGuid().ToString("N");
        try
        {
            using(var store=new JobStore(path))store.Save(new(request,new(id,"running",DateTimeOffset.UtcNow,null,null,null,RemoteId:remoteJob.Id)));
            using var remote=new RemoteEngineWorker(service.Address,service.Token,CoreEngine.Info.Version);
            await using var jobs=new JobCoordinator(remote,store:new JobStore(path));
            Assert.Equal("succeeded",(await JobTests.FinishedAsync(jobs,id)).State);
            Assert.Single((await service.Client.GetFromJsonAsync<JobView[]>("api/jobs"))!);
        }
        finally{DurableJobTests.Clean(path);}
    }
    [Fact]
    public async Task A_recovered_remote_cancellation_preserves_the_stop_request()
    {
        await using var service=new ComputeService();await service.StartAsync();var request=WorkerTests.SlowRequest with{TimeoutSeconds=600};
        var accepted=await service.Client.PostAsJsonAsync("api/jobs",request);var remoteJob=(await accepted.Content.ReadFromJsonAsync<JobView>())!;
        string path=Path.Combine(Path.GetTempPath(),"visual-dsd-cancel-"+Guid.NewGuid().ToString("N")),id=Guid.NewGuid().ToString("N");
        try
        {
            using(var store=new JobStore(path))store.Save(new(request,new(id,"cancelling",DateTimeOffset.UtcNow,null,null,null,RemoteId:remoteJob.Id)));
            using var remote=new RemoteEngineWorker(service.Address,service.Token,CoreEngine.Info.Version);await using var jobs=new JobCoordinator(remote,store:new JobStore(path));
            Assert.Equal("cancelled",(await JobTests.FinishedAsync(jobs,id)).State);
            Assert.Equal("cancelled",(await service.Client.GetFromJsonAsync<JobView>($"api/jobs/{remoteJob.Id}"))!.State);
            Assert.Single((await service.Client.GetFromJsonAsync<JobView[]>("api/jobs"))!);
        }
        finally{DurableJobTests.Clean(path);}
    }
    private sealed class RejectCancellation:HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if(request.Method==HttpMethod.Delete)throw new HttpRequestException("Connection lost during cancellation");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(CoreEngine.Info)});
        }
    }
    [Fact]
    public async Task Unconfirmed_remote_cancellation_is_not_reported_as_stopped()
    {
        using var remote=new RemoteEngineWorker(new("http://127.0.0.1:1"),new string('t',32),CoreEngine.Info.Version,new RejectCancellation());
        using var stop=new CancellationTokenSource();stop.Cancel();
        var error=await Assert.ThrowsAsync<WorkerFailure>(()=>remote.ResumeAsync(new(){Code="<a>"},new string('a',32),_=>{},stop.Token));
        Assert.Equal("REMOTE_CANCEL_UNKNOWN",error.Code);
    }
    [Fact]
    public async Task Ambiguous_remote_submissions_are_never_retried_and_external_plaintext_origins_are_rejected()
    {
        var handler=new LostResponse();using var worker=new RemoteEngineWorker(new("http://127.0.0.1:1"),new string('t',32),CoreEngine.Info.Version,handler);Assert.Equal("REMOTE_SUBMISSION_UNKNOWN",(await Assert.ThrowsAsync<WorkerFailure>(()=>worker.ExecuteAsync(new(){Code="<a>"},CancellationToken.None))).Code);Assert.Equal(1,handler.Posts);
        foreach(string uri in new[]{"http://example.com/","https://user:pass@example.com/","https://example.com/?secret=x","https://example.com/path"})Assert.Throws<ArgumentException>(()=>new RemoteEngineWorker(new(uri),new string('t',32),CoreEngine.Info.Version));
    }
}
