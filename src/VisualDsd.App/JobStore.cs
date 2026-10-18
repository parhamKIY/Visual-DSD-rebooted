using System.Text.Json;
using VisualDsd.Contracts;

namespace VisualDsd.App;

public sealed record StoredJob(ModelRequest Request, JobView View);
public sealed class JobStore : IDisposable
{
    private readonly string root;
    private readonly FileStream ownership;
    public JobStore(string directory)
    {
        root=Path.GetFullPath(directory);Directory.CreateDirectory(root);
        ownership=new FileStream(Path.Combine(root,".owner"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    }
    private string FileName(string id)
    {
        if(id.Length!=32 || !id.All(Uri.IsHexDigit))throw new ArgumentException("Invalid job identifier.");
        return Path.Combine(root,id+".json");
    }
    public StoredJob[] Load(int capacity)
    {
        var records=new List<StoredJob>();
        foreach(string file in Directory.EnumerateFiles(root,"*.json").OrderByDescending(File.GetLastWriteTimeUtc).Take(capacity))
        {
            if(new FileInfo(file).Length>24L*1024*1024)throw new IOException("A stored job exceeds its size limit.");
            var item=JsonSerializer.Deserialize<StoredJob>(File.ReadAllText(file),ProcessEngineWorker.Json)??throw new IOException("A stored job is invalid.");
            if(FileName(item.View.Id)!=file || RequestValidation.Validate(item.Request).Length>0)throw new IOException("A stored job is invalid.");
            records.Add(item);
        }
        return records.ToArray();
    }
    public void Save(StoredJob job)
    {
        string file=FileName(job.View.Id),pending=file+".pending";
        File.WriteAllText(pending,JsonSerializer.Serialize(job,ProcessEngineWorker.Json));
        File.Move(pending,file,true);
    }
    public void Delete(string id)=>File.Delete(FileName(id));
    public void Dispose()=>ownership.Dispose();
}
