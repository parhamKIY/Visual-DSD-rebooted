using System.Diagnostics;
using System.Threading;

namespace VisualDsd.Contracts;

public sealed record EngineProgress(string Phase, string Message, string? Run = null, double? Time = null,
    int? Completed = null, int? Total = null, ObservationData? Preview = null, string? RemoteId = null)
{
    public bool IsValid() => Phase is "preparing" or "expanding" or "simulating" or "inference" or "exploring" or "exporting" or "synthesis" or "completed" or "remote"
        && !string.IsNullOrWhiteSpace(Message) && Message.Length <= 512 && (Run is null || Run.Length <= 512)
        && (!Time.HasValue || double.IsFinite(Time.Value)) && Completed is not < 0 && Total is not < 0
        && (!Completed.HasValue || !Total.HasValue || Completed <= Total)
        && (RemoteId is null || (RemoteId.Length == 32 && RemoteId.All(Uri.IsHexDigit)))
        && (Preview is null || Preview.Times is {Length: <= 200} && Preview.Times.All(double.IsFinite)
            && Preview.Times.Zip(Preview.Times.Skip(1)).All(p => p.First <= p.Second)
            && Preview.Series is {Length: <= 8} && Preview.Series.All(s => s is not null && s.Name is {Length: <= 512}
                && s.Values is not null && s.Values.Length == Preview.Times.Length && s.Values.All(double.IsFinite) && s.StandardDeviation is null));
}

// A worker owns one synchronous calculation. AsyncLocal also isolates direct adapter callers.
public static class EngineTelemetry
{
    private sealed class Context(Action<EngineProgress> report) { public Action<EngineProgress> Report = report; public long Last; public string? Phase; }
    private static readonly AsyncLocal<Context?> Current = new();
    public static bool Active => Current.Value is not null;
    public static bool Ready => Current.Value is { } c && Stopwatch.GetElapsedTime(c.Last).TotalMilliseconds >= 250;
    public static IDisposable Begin(Action<EngineProgress> report)
    {
        var previous=Current.Value; Current.Value=new(report); return new Scope(()=>Current.Value=previous);
    }
    public static void Report(EngineProgress progress, bool force = false)
    {
        var c=Current.Value;
        if(c is null || (!force && c.Phase==progress.Phase && !Ready))return;
        if(!progress.IsValid())return;
        c.Last=Stopwatch.GetTimestamp(); c.Phase=progress.Phase; c.Report(progress);
    }
    private sealed class Scope(Action restore):IDisposable { public void Dispose()=>restore(); }
}
