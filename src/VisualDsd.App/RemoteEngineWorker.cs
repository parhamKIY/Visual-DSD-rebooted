using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using VisualDsd.Contracts;

namespace VisualDsd.App;

public sealed class RemoteEngineWorker : IEngineWorker, IDisposable
{
    private readonly HttpClient client;
    private readonly string version;
    public RemoteEngineWorker(Uri address,string token,string version,HttpMessageHandler? handler=null)
    {
        if(!address.IsAbsoluteUri || address.UserInfo.Length>0 || address.Query.Length>0 || address.Fragment.Length>0 || address.AbsolutePath!="/"
            || (address.Scheme!="https" && !(address.Scheme=="http" && address.IsLoopback)))throw new ArgumentException("Remote execution requires an HTTPS origin or a loopback SSH tunnel.");
        if(token.Length<32 || token.Length>4096 || token.Any(char.IsControl))throw new ArgumentException("The compute token must have 32..4096 characters without control characters.");
        this.version=version;
        client=new HttpClient(handler??new HttpClientHandler{AllowAutoRedirect=false}){BaseAddress=address,Timeout=TimeSpan.FromSeconds(15)};
        client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",token);
    }
    public Task<EngineResponse> ExecuteAsync(ModelRequest request,CancellationToken token)=>ExecuteAsync(request,_=>{},token);
    public async Task<EngineResponse> ExecuteAsync(ModelRequest request,Action<EngineProgress> report,CancellationToken token)
    {
        Diagnostic[] invalid=RequestValidation.Validate(request);
        if(invalid.Length>0)return new(false,request.Operation,request.Dialect,null,invalid);
        var info=await GetAsync<EngineInfo>("api/info",token);
        if(info.Name!="Visual DSD Rebooted" || info.Version!=version)throw new WorkerFailure("REMOTE_VERSION","The compute service must run the same engine version as this workspace.");
        report(new("remote","Submitting to the configured compute service."));
        JobView job;
        try
        {
            using var content=new StringContent(JsonSerializer.Serialize(request,ProcessEngineWorker.Json),Encoding.UTF8,"application/json");
            using var attempt=CancellationTokenSource.CreateLinkedTokenSource(token);attempt.CancelAfter(TimeSpan.FromSeconds(15));
            using var submission=new HttpRequestMessage(HttpMethod.Post,"api/jobs"){Content=content};
            using var response=await client.SendAsync(submission,HttpCompletionOption.ResponseHeadersRead,attempt.Token);
            if(response.StatusCode==HttpStatusCode.TooManyRequests)throw new WorkerFailure("REMOTE_QUEUE_FULL","The compute queue is full; no job was admitted.");
            if(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)throw new WorkerFailure("REMOTE_AUTH","The compute service rejected its access token.");
            if(response.StatusCode!=HttpStatusCode.Accepted)throw new WorkerFailure("REMOTE_SUBMISSION_UNKNOWN","The remote submission was not confirmed. It was not retried; inspect the compute service before resubmitting.");
            job=await ReadAsync<JobView>(response,attempt.Token);
            CheckId(job.Id);
        }
        catch(Exception error) when(error is HttpRequestException or JsonException or IOException or OperationCanceledException)
        {
            // A lost POST response cannot establish whether the remote service accepted the work.
            throw new WorkerFailure("REMOTE_SUBMISSION_UNKNOWN","The remote submission outcome is unknown. It was not retried; inspect the compute service before resubmitting.");
        }
        report(new("remote","Remote job admitted.",RemoteId:job.Id));
        return await ResumeAsync(request,job.Id,report,token);
    }
    public async Task<EngineResponse> ResumeAsync(ModelRequest request,string id,Action<EngineProgress> report,CancellationToken token)
    {
        CheckId(id);long revision=-1;
        try
        {
            var info=await GetAsync<EngineInfo>("api/info",token);
            if(info.Name!="Visual DSD Rebooted" || info.Version!=version)throw new WorkerFailure("REMOTE_VERSION","The compute service must run the same engine version as this workspace.");
            while(true)
            {
                var job=await GetAsync<JobView>("api/jobs/"+id,token);
                if(job.EngineVersion is not null && job.EngineVersion!=version)throw new WorkerFailure("REMOTE_VERSION","The retained compute job used a different engine version.");
                if(job.Id!=id)throw new WorkerFailure("REMOTE_PROTOCOL","The compute service returned a different job.");
                if(job.Progress is not null && !job.Progress.IsValid())throw new WorkerFailure("REMOTE_PROTOCOL","The compute service returned invalid progress.");
                if(job.Revision!=revision)
                {
                    report((job.Progress??new EngineProgress("remote",job.State=="queued"?"Waiting in the compute queue.":"Running on the compute service.")) with{RemoteId=id});revision=job.Revision;
                }
                if(job.FinishedAt.HasValue)
                {
                    if(job.State=="cancelled")throw new OperationCanceledException(token);
                    var result=job.Result??throw new WorkerFailure("REMOTE_PROTOCOL","The compute service returned no result.");
                    if(!result.Success && result.Dialect=="auto")result=result with{Dialect=request.Language=="crn"?"current":request.Code.Contains("//old_syntax",StringComparison.Ordinal)?"legacy":"current"};
                    ProcessEngineWorker.ValidateResponse(request,result);
                    return result;
                }
                await Task.Delay(500,token);
            }
        }
        catch(OperationCanceledException) when(token.IsCancellationRequested)
        {
            using var stop=new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                using var response=await client.DeleteAsync("api/jobs/"+id,stop.Token);
                if(!response.IsSuccessStatusCode)throw new HttpRequestException();
                while(!(await GetAsync<JobView>("api/jobs/"+id,stop.Token)).FinishedAt.HasValue)await Task.Delay(100,stop.Token);
            }
            catch(Exception error)when(error is HttpRequestException or OperationCanceledException or WorkerFailure)
            {throw new WorkerFailure("REMOTE_CANCEL_UNKNOWN","Remote cancellation could not be confirmed. The compute job may still be running; its identifier is retained for reconnection.");}
            throw;
        }
        catch(Exception error)when(error is HttpRequestException or JsonException or IOException or TaskCanceledException)
        {
            throw new WorkerFailure("REMOTE_CONNECTION","The compute connection was lost. The remote job may still be running; its identifier is retained and Resume reconnects without resubmitting.");
        }
    }
    private static void CheckId(string id)
    {
        if(id is null || id.Length!=32 || !id.All(Uri.IsHexDigit))throw new WorkerFailure("REMOTE_PROTOCOL","The compute service returned an invalid job identifier.");
    }
    private async Task<T> GetAsync<T>(string path,CancellationToken token)
    {
        using var attempt=CancellationTokenSource.CreateLinkedTokenSource(token);attempt.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            using var response=await client.GetAsync(path,HttpCompletionOption.ResponseHeadersRead,attempt.Token);
            if(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)throw new WorkerFailure("REMOTE_AUTH","The compute service rejected its access token.");
            if(!response.IsSuccessStatusCode)throw new WorkerFailure("REMOTE_CONNECTION","The compute service did not provide the requested job or engine information.");
            return await ReadAsync<T>(response,attempt.Token);
        }
        catch(OperationCanceledException)when(token.IsCancellationRequested){throw;}
        catch(Exception error)when(error is HttpRequestException or JsonException or IOException or OperationCanceledException)
        {throw new WorkerFailure("REMOTE_CONNECTION","The compute service could not be reached or returned an invalid response.");}
    }
    private static async Task<T> ReadAsync<T>(HttpResponseMessage response,CancellationToken token)
    {
        const int maximum=32*1024*1024;
        if(response.Content.Headers.ContentLength>maximum)throw new WorkerFailure("REMOTE_PROTOCOL","The compute response exceeds its size limit.");
        using var stream=await response.Content.ReadAsStreamAsync(token);using var buffer=new MemoryStream();var bytes=new byte[8192];int count;
        while((count=await stream.ReadAsync(bytes,token))>0){if(buffer.Length+count>maximum)throw new WorkerFailure("REMOTE_PROTOCOL","The compute response exceeds its size limit.");buffer.Write(bytes,0,count);}
        return JsonSerializer.Deserialize<T>(buffer.ToArray(),ProcessEngineWorker.Json)??throw new WorkerFailure("REMOTE_PROTOCOL","The compute response is empty.");
    }
    public void Dispose()=>client.Dispose();
}
