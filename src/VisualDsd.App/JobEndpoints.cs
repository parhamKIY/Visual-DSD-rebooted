using System.Text.Json;
using VisualDsd.Contracts;

namespace VisualDsd.App;

internal static class JobEndpoints
{
    public static void Map(WebApplication app,JobCoordinator jobs)
    {
        app.MapGet("/api/jobs",()=>Results.Json(jobs.List()));
        app.MapGet("/api/jobs/{id}",(string id)=>jobs.Get(id) is {} job?Results.Json(job):Results.NotFound());
        app.MapGet("/api/jobs/{id}/input",(string id)=>jobs.Input(id) is {} input?Results.Json(input):Results.NotFound());
        app.MapPost("/api/jobs",(ModelRequest request)=>
        {
            JobAdmission admission=jobs.Enqueue(request);
            return admission.Job is {} job?Results.Json(job,statusCode:202):Results.Json(new{diagnostics=admission.Diagnostics},statusCode:admission.Busy?429:400);
        });
        app.MapDelete("/api/jobs/{id}",(string id)=>jobs.Cancel(id) is {} job?Results.Json(job,statusCode:202):Results.NotFound());
        app.MapPost("/api/jobs/{id}/resume",(string id)=>jobs.Resume(id) is {} job?Results.Json(job,statusCode:202):Results.NotFound());
        app.MapGet("/api/jobs/{id}/events",async (string id,HttpContext context)=>
        {
            if(jobs.Get(id) is null){context.Response.StatusCode=404;return;}
            context.Response.ContentType="text/event-stream";
            context.Response.Headers.CacheControl="no-store";context.Response.Headers["X-Accel-Buffering"]="no";
            long revision=-1;int heartbeat=0;
            try
            {
                while(!context.RequestAborted.IsCancellationRequested)
                {
                    var job=jobs.Get(id);
                    if(job is null){await context.Response.WriteAsync("event: gone\ndata: {}\n\n",context.RequestAborted);return;}
                    if(revision!=job.Revision)
                    {
                        await context.Response.WriteAsync($"id: {job.Revision}\nevent: job\ndata: {JsonSerializer.Serialize(job,ProcessEngineWorker.Json)}\n\n",context.RequestAborted);
                        await context.Response.Body.FlushAsync(context.RequestAborted);revision=job.Revision;heartbeat=0;
                    }
                    if(job.FinishedAt.HasValue)return;
                    if(++heartbeat>=40){await context.Response.WriteAsync(": keep-alive\n\n",context.RequestAborted);await context.Response.Body.FlushAsync(context.RequestAborted);heartbeat=0;}
                    await Task.Delay(250,context.RequestAborted);
                }
            }
            catch(OperationCanceledException)when(context.RequestAborted.IsCancellationRequested){}
        });
    }
}
