using System.Text.Json;
using System.Diagnostics;
using System.IO.Pipes;
using VisualDsd.App;
using VisualDsd.Contracts;

// Authored process-adapter fixture, not a scientific alignment implementation.
if(args.SequenceEqual(new[]{"-version"})){Console.WriteLine("muscle 5.0 authored-adapter-test-probe");return 0;}
if(args.Contains("-align"))
{
    string inputPath=args[Array.IndexOf(args,"-align")+1],outputPath=args[Array.IndexOf(args,"-output")+1];
    string text=await File.ReadAllTextAsync(inputPath);
    if(text.Contains("CCCC")){Console.Error.Write("Authored test exit");return 7;}
    if(text.Contains("GGGG")){Console.Error.Write(new string('x',100000));return 0;}
    if(text.Contains("TTTT")){await Task.Delay(Timeout.Infinite);return 0;}
    var records=text.Split('>',StringSplitOptions.RemoveEmptyEntries).Select(block=>{var lines=block.Trim().Split('\n');return(Name:lines[0],Sequence:string.Concat(lines.Skip(1)));}).ToArray();
    int width=records.Max(r=>r.Sequence.Length);await File.WriteAllTextAsync(outputPath,string.Concat(records.Reverse().Select(r=>$">{r.Name}\n{(text.Contains("ACAC")?r.Sequence.Replace('A','C'):r.Sequence).PadRight(width,'-')}\n")));return 0;
}
if (args.Length == 3 && args[0] == "--owner")
{
    string pipeName = "visual-dsd-test-" + Guid.NewGuid().ToString("N");
    using var ownerPipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
    var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
    start.ArgumentList.Add(args[1]); start.ArgumentList.Add("--worker"); start.Environment[WorkerLifetime.OwnerVariable] = pipeName;
    using var worker = Process.Start(start)!;
    var connected = ownerPipe.WaitForConnectionAsync();
    var output = worker.StandardOutput.ReadToEndAsync(); var errors = worker.StandardError.ReadToEndAsync();
    await worker.StandardInput.WriteAsync("{\"code\":\"directive simulator stochastic\\n(1000 * <a> | rxn <a> ->{1.0} <a>)\",\"operation\":\"simulate\",\"final\":1000000000000,\"points\":1,\"seed\":42}");
    worker.StandardInput.Close(); await connected;
    await File.WriteAllTextAsync(args[2] + ".pending", worker.Id.ToString()); File.Move(args[2] + ".pending", args[2]);
    await Task.WhenAll(worker.WaitForExitAsync(), output, errors);
    return worker.ExitCode;
}
using var ownerLifetime = new WorkerLifetime();
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var request = JsonSerializer.Deserialize<ModelRequest>(await Console.In.ReadToEndAsync(), json)!;
var model = new ModelData("classic", "default", false, new("oslo", 0, 1, 10, null, "s", "nM"), [], [], []);
var response = new EngineResponse(true, request.Operation, "current", model, []);
switch (request.Code)
{
    case "malformed-progress": Console.WriteLine("@progress {invalid}"); break;
    case "invalid-progress": Console.WriteLine("@progress "+JsonSerializer.Serialize(new EngineProgress("invalid","Invalid phase"),json)); break;
    case "oversized-progress": Console.WriteLine("@progress "+new string('x',128*1024)); break;
    case "oversized-output": Console.Write(new string('x', 9 * 1024 * 1024)); return 0;
    case "oversized-errors": Console.Error.Write(new string('x', 70 * 1024)); return 1;
    case "empty": return 0;
    case "malformed": Console.Write("{invalid}"); return 0;
    case "incomplete": Console.Write("{\"success\":true}"); return 0;
    case "wrong-operation": response = response with { Operation = "infer" }; break;
    case "wrong-dialect": response = response with { Dialect = "legacy" }; break;
    case "missing-model": response = response with { Model = null }; break;
    case "missing-diagnostics": response = response with { Diagnostics = null! }; break;
    case "false-success": response = response with { Diagnostics = [new("ERROR", "Not a successful result.")] }; break;
    case "empty-failure": response = response with { Success = false, Model = null }; break;
    case "valid-failure": response = EngineResponse.Failure(request with { Dialect = "current" }, "MODEL_ERROR", "Expected model failure."); break;
    case "failure-with-model": response = response with { Success = false, Diagnostics = [new("ERROR", "Failure carrying a model.")] }; break;
}
Console.Write(JsonSerializer.Serialize(response, json));
return request.Code is "bad-exit" or "valid-failure" ? 1 : 0;
