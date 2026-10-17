using System.IO.Pipes;

namespace VisualDsd.App;

// The OS closes this pipe if the owner dies. No cross-process wall-clock comparison is needed.
internal sealed class WorkerLifetime : IDisposable
{
    internal const string OwnerVariable = "VISUAL_DSD_WORKER_OWNER";
    private readonly NamedPipeClientStream? pipe;
    private readonly Thread? monitor;
    private int stopped;
    private readonly CancellationTokenSource shutdown = new();

    public WorkerLifetime()
    {
        string? owner = Environment.GetEnvironmentVariable(OwnerVariable);
        if (owner is null) return;
        pipe = new NamedPipeClientStream(".", owner, PipeDirection.In, PipeOptions.Asynchronous);
        try { pipe.Connect(5000); }
        catch (Exception error) when (error is IOException or TimeoutException) { Environment.Exit(1); return; }
        monitor = new Thread(Watch) { IsBackground = true, Name = "Worker owner monitor" };
        monitor.Start();
    }

    private void Watch()
    {
        try { pipe!.ReadAsync(new byte[1], shutdown.Token).AsTask().GetAwaiter().GetResult(); }
        catch (Exception error) when (error is IOException or ObjectDisposedException or OperationCanceledException) { }
        if (Volatile.Read(ref stopped) == 0) Environment.Exit(1);
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref stopped, 1);
        shutdown.Cancel();
        pipe?.Dispose();
        monitor?.Join(1000);
        shutdown.Dispose();
    }
}
