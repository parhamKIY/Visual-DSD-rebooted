using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace VisualDsd.App;

public sealed record MuscleSequence(string Name,string Sequence);
public sealed record MuscleRequest(string Alphabet,MuscleSequence[] Records);
public sealed class MuscleFailure(int status,string message):Exception(message){public int Status{get;}=status;}

// Optional, separately installed native executable. Browser requests cannot select
// an executable, command line or filesystem path. No shell is involved.
public sealed class MuscleTool(string? configuredPath,IReadOnlyDictionary<string,string>? processEnvironment=null,int runTimeoutSeconds=120)
{
    private readonly SemaphoreSlim gate=new(1,1);
    public static string Validate(MuscleRequest request)
    {
        string letters=request.Alphabet switch{"DNA"=>"ACGT","RNA"=>"ACGU","protein"=>"ACDEFGHIKLMNPQRSTVWY",_=>throw new MuscleFailure(400,"Choose DNA, RNA or protein.")};
        if(request.Records is null||request.Records.Length is <2 or >30)throw new MuscleFailure(400,"The optional tool accepts 2–30 sequences.");
        var names=new HashSet<string>(StringComparer.Ordinal);int total=0;
        foreach(var r in request.Records){if(r is null||string.IsNullOrEmpty(r.Name)||r.Name.Length>120||r.Name.Any(c=>char.IsWhiteSpace(c)||char.IsControl(c)||c=='>')||!names.Add(r.Name)||string.IsNullOrEmpty(r.Sequence)||r.Sequence.Length>2000||r.Sequence.Any(c=>!letters.Contains(c)))throw new MuscleFailure(400,"Use unique IDs and ungapped, unambiguous sequences of 1–2000 symbols (standard 20 residues for proteins). Nothing was removed or guessed.");total+=r.Sequence.Length;}
        if(total>20000)throw new MuscleFailure(400,"Optional-tool input exceeds 20000 symbols.");
        return string.Concat(request.Records.Select(r=>$">{r.Name}\n{r.Sequence}\n"));
    }
    private string Executable()
    {
        if(string.IsNullOrWhiteSpace(configuredPath))throw new MuscleFailure(503,"MUSCLE 5 is optional and not configured. Set VISUAL_DSD_MUSCLE to its full native executable path before starting the app, or import an aligned FASTA file.");
        if(!Path.IsPathFullyQualified(configuredPath)||!File.Exists(configuredPath)||(OperatingSystem.IsWindows()?Path.GetExtension(configuredPath).ToLowerInvariant()!=".exe":new[]{".sh",".bat",".cmd",".ps1"}.Contains(Path.GetExtension(configuredPath).ToLowerInvariant())))throw new MuscleFailure(503,"Configured MUSCLE path must identify an existing native executable; shell scripts are not accepted.");return configuredPath;
    }
    private static string Digest(byte[] value)=>Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private static async Task<string> Limited(StreamReader reader,int limit,Action stop,CancellationToken token)
    {
        var result=new StringBuilder();char[] buffer=new char[4096];int count;
        while((count=await reader.ReadAsync(buffer,token))>0){if(result.Length+count>limit){stop();throw new MuscleFailure(502,"MUSCLE output/log exceeded its supported limit.");}result.Append(buffer,0,count);}return result.ToString();
    }
    private static async Task<(string Output,string Error)> Run(string exe,string directory,string[] arguments,int seconds,CancellationToken cancellation,IReadOnlyDictionary<string,string>? environment)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation);timeout.CancelAfter(TimeSpan.FromSeconds(seconds));
        using var process=new Process{StartInfo=new(exe){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=directory,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8}};
        foreach(var argument in arguments)process.StartInfo.ArgumentList.Add(argument);
        if(environment is not null)foreach(var entry in environment)process.StartInfo.Environment[entry.Key]=entry.Value;
        void Stop(){try{if(!process.HasExited)process.Kill(true);}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}}
        try
        {
            if(!process.Start())throw new MuscleFailure(502,"MUSCLE failed to start.");
            var output=Limited(process.StandardOutput,65536,Stop,timeout.Token);var errors=Limited(process.StandardError,65536,Stop,timeout.Token);
            await Task.WhenAll(process.WaitForExitAsync(timeout.Token),output,errors);
            if(process.ExitCode!=0)throw new MuscleFailure(502,$"MUSCLE exited with code {process.ExitCode}. "+(await errors)[..Math.Min(1000,(await errors).Length)]);
            return(await output,await errors);
        }
        catch(OperationCanceledException){Stop();throw new MuscleFailure(cancellation.IsCancellationRequested?499:504,cancellation.IsCancellationRequested?"MUSCLE run cancelled; no output was imported.":"MUSCLE exceeded its time limit; no output was imported.");}
        finally{Stop();try{await process.WaitForExitAsync(CancellationToken.None);}catch(InvalidOperationException){}}
    }
    private static string Version((string Output,string Error) run)
    {
        var match=Regex.Match(run.Output+"\n"+run.Error,@"muscle\s+5(?:\.[^\r\n]*|\s[^\r\n]*)",RegexOptions.IgnoreCase);
        if(!match.Success||match.Value.Length>500)throw new MuscleFailure(502,"This adapter requires MUSCLE major version 5; the version probe was not recognized.");return match.Value.Trim();
    }
    private static string CreateDirectory()
    {
        string path=Path.Combine(Path.GetTempPath(),"visual-dsd-muscle-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(path);return path;
    }
    private static void Cleanup(string directory)
    {
        string absolute=Path.GetFullPath(directory),parent=Path.GetFullPath(Path.GetTempPath());
        if(!absolute.StartsWith(Path.TrimEndingDirectorySeparator(parent)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!Regex.IsMatch(Path.GetFileName(absolute),@"^visual-dsd-muscle-[a-f0-9]{32}$"))throw new InvalidOperationException("Invalid generated-tool directory.");
        try{Directory.Delete(absolute,true);}catch(IOException){}catch(UnauthorizedAccessException){}
    }
    public async Task<object> StatusAsync(CancellationToken token)
    {
        if(!await gate.WaitAsync(0,token))return new{available=false,reason="An alignment run is active."};string? directory=null;
        try{string exe=Executable();directory=CreateDirectory();string version=Version(await Run(exe,directory,["-version"],5,token,processEnvironment));return new{available=true,name="MUSCLE 5",version,executableSha256=Digest(await File.ReadAllBytesAsync(exe,token))};}
        catch(MuscleFailure error){return new{available=false,reason=error.Message};}
        finally{if(directory is not null)Cleanup(directory);gate.Release();}
    }
    public async Task<object> AlignAsync(MuscleRequest request,CancellationToken token)
    {
        string original=Validate(request),exe=Executable();if(!await gate.WaitAsync(0,token))throw new MuscleFailure(409,"Another MUSCLE request is active. No duplicate run was started.");string? directory=null;
        try
        {
            directory=CreateDirectory();string hash=Digest(await File.ReadAllBytesAsync(exe,token)),version=Version(await Run(exe,directory,["-version"],5,token,processEnvironment));
            string input=string.Concat(request.Records.Select((r,i)=>$">sequence_{i+1}\n{(request.Alphabet=="RNA"?r.Sequence.Replace('U','T'):r.Sequence)}\n"));
            await File.WriteAllTextAsync(Path.Combine(directory,"input.fasta"),input,new UTF8Encoding(false),token);
            string[] arguments=["-align","input.fasta","-output","output.afa","-threads","1","-perturb","0","-perm","none",request.Alphabet=="protein"?"-amino":"-nt"];
            var run=await Run(exe,directory,arguments,runTimeoutSeconds,token,processEnvironment);string outputPath=Path.Combine(directory,"output.afa");
            if(!File.Exists(outputPath)||new FileInfo(outputPath).Length>2*1024*1024)throw new MuscleFailure(502,"MUSCLE returned no bounded aligned FASTA output.");
            string raw=await File.ReadAllTextAsync(outputPath,token);var rows=new Dictionary<string,string>(StringComparer.Ordinal);string? id=null;
            foreach(string line in raw.Replace("\r","").Split('\n')){if(string.IsNullOrWhiteSpace(line))continue;if(line.StartsWith('>')){id=line[1..].Trim();if(rows.ContainsKey(id))throw new MuscleFailure(502,"MUSCLE repeated a record identifier.");rows.Add(id,"");}else{if(id is null||!Regex.IsMatch(line.Trim(),"^[A-Za-z-]+$"))throw new MuscleFailure(502,"MUSCLE returned invalid sequence output.");rows[id]+=line.Trim().ToUpperInvariant();}}
            int width=rows.Count>0?rows.First().Value.Length:0;
            if(rows.Count!=request.Records.Length||width is <1 or >20000||rows.Values.Any(s=>s.Length!=width)||rows.Values.Sum(s=>s.Length)>500000)throw new MuscleFailure(502,"MUSCLE output has missing records, unequal row lengths or exceeds the alignment limit.");
            var mapped=new List<string>();
            for(int i=0;i<request.Records.Length;i++){if(!rows.TryGetValue($"sequence_{i+1}",out string? aligned))throw new MuscleFailure(502,"MUSCLE changed the input identifier set.");if(request.Alphabet=="RNA")aligned=aligned.Replace('T','U');if(aligned.Replace("-","")!=request.Records[i].Sequence)throw new MuscleFailure(502,"MUSCLE changed sequence symbols. No output was imported.");mapped.Add($">{request.Records[i].Name}\n{aligned}\n");}
            if(hash!=Digest(await File.ReadAllBytesAsync(exe,token)))throw new MuscleFailure(502,"MUSCLE executable changed during the run.");
            return new{text=string.Concat(mapped),tool=new{name="MUSCLE 5",version,executableSha256=hash,inputSha256=Digest(Encoding.UTF8.GetBytes(original)),inputFasta=original,arguments,finishedAt=DateTimeOffset.UtcNow,rawOutput=raw,standardError=run.Error}};
        }
        finally{if(directory is not null)Cleanup(directory);gate.Release();}
    }
    public static void Map(WebApplication app)
    {
        var tool=new MuscleTool(Environment.GetEnvironmentVariable("VISUAL_DSD_MUSCLE"));
        async Task<IResult> Execute(Func<CancellationToken,Task<object>> action,CancellationToken token)
        {
            try{return Results.Json(await action(token));}
            catch(MuscleFailure error){return Results.Json(new{error=error.Message},statusCode:error.Status);}
            catch(Exception error)when(error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or OperationCanceledException){return Results.Json(new{error="The optional tool could not run or was cancelled. Check the configured native executable. No result was imported."},statusCode:502);}
        }
        app.MapGet("/api/sequences/muscle",(Func<HttpContext,Task<IResult>>)(context=>Execute(tool.StatusAsync,context.RequestAborted)));
        app.MapPost("/api/sequences/muscle",(MuscleRequest request,HttpContext context)=>Execute(token=>tool.AlignAsync(request,token),context.RequestAborted));
    }
}
