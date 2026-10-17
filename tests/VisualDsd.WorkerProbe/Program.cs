using System.Text.Json;
using VisualDsd.Contracts;

if (args.Contains("--lifetime")) { await Task.Delay(TimeSpan.FromSeconds(30)); return 0; }
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var request = JsonSerializer.Deserialize<ModelRequest>(await Console.In.ReadToEndAsync(), json)!;
var model = new ModelData("classic", "default", false, new("oslo", 0, 1, 10, null, "s", "nM"), [], [], []);
var response = new EngineResponse(true, request.Operation, "current", model, []);
switch (request.Code)
{
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
