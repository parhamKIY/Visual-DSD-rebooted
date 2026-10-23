using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using VisualDsd.App;
using Xunit;

namespace VisualDsd.Tests;
[Collection("Process integration")]
public class MuscleToolTests
{
    private static MuscleTool Probe(int seconds=120)
    {
        var runtime=new DirectoryInfo(System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory()).Parent!.Parent!.Parent!.FullName;
        string executable=Path.Combine(LocalHost.Root,"tests","VisualDsd.WorkerProbe","bin","Release","net10.0",OperatingSystem.IsWindows()?"VisualDsd.WorkerProbe.exe":"VisualDsd.WorkerProbe");
        return new(executable,new Dictionary<string,string>{{"DOTNET_ROOT",runtime},{"DOTNET_ROOT_X64",runtime}},seconds);
    }
    private static MuscleRequest Input(string sequence="AAA")=>new("DNA",[new("first",sequence),new("second","AC")]);
    [Fact]
    public async Task Optional_absent_invalid_and_unsupported_inputs_fail_without_starting_a_process()
    {
        var status=JsonSerializer.SerializeToElement(await new MuscleTool(null).StatusAsync(default));Assert.False(status.GetProperty("available").GetBoolean());
        Assert.Equal(503,(await Assert.ThrowsAsync<MuscleFailure>(()=>new MuscleTool(null).AlignAsync(Input(),default))).Status);
        foreach(var bad in new[]{new MuscleRequest("DNA",[new("same","AA"),new("same","AC")]),Input("ANN"),Input("A-C"),Input(new string('A',2001))})Assert.Throws<MuscleFailure>(()=>MuscleTool.Validate(bad));
    }
    [Fact]
    public async Task Real_process_adapter_retains_version_hashes_input_options_and_unchanged_letters()
    {
        var service=Probe();var status=JsonSerializer.SerializeToElement(await service.StatusAsync(default));Assert.True(status.GetProperty("available").GetBoolean());
        var result=JsonSerializer.SerializeToElement(await service.AlignAsync(Input(),default));Assert.StartsWith(">first\n",result.GetProperty("text").GetString());Assert.Contains(">second\nAC-",result.GetProperty("text").GetString());var tool=result.GetProperty("tool");Assert.Contains("authored-adapter-test-probe",tool.GetProperty("version").GetString());Assert.Equal(64,tool.GetProperty("inputSha256").GetString()!.Length);Assert.Equal(64,tool.GetProperty("executableSha256").GetString()!.Length);Assert.Contains("-threads",tool.GetProperty("arguments").EnumerateArray().Select(v=>v.GetString()));
    }
    [Theory]
    [InlineData("CCCC")]
    [InlineData("GGGG")]
    [InlineData("ACAC")]
    public async Task Nonzero_exit_oversized_log_and_changed_sequence_never_return_alignment(string input)
    {Assert.Equal(502,(await Assert.ThrowsAsync<MuscleFailure>(()=>Probe().AlignAsync(Input(input),default))).Status);}
    [Fact]
    public async Task Timeout_cancellation_and_duplicate_requests_do_not_leave_an_importable_result()
    {
        Assert.Equal(504,(await Assert.ThrowsAsync<MuscleFailure>(()=>Probe(1).AlignAsync(Input("TTTT"),default))).Status);
        var service=Probe();using var stop=new CancellationTokenSource();var pending=service.AlignAsync(Input("TTTT"),stop.Token);
        Assert.Equal(409,(await Assert.ThrowsAsync<MuscleFailure>(()=>service.AlignAsync(Input(),default))).Status);stop.Cancel();Assert.Equal(499,(await Assert.ThrowsAsync<MuscleFailure>(()=>pending)).Status);
        Assert.True(JsonSerializer.SerializeToElement(await service.StatusAsync(default)).GetProperty("available").GetBoolean());
    }
}
[Collection("Process integration")]
public class MuscleEndpointTests(LocalHost host):IClassFixture<LocalHost>
{
    [Fact]
    public async Task Optional_endpoint_is_readable_without_a_tool_and_has_the_same_origin_guard()
    {
        Assert.Equal(HttpStatusCode.OK,(await host.Client.GetAsync("/api/sequences/muscle")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await host.Client.PostAsJsonAsync("/api/sequences/muscle",new MuscleRequest("invalid",[]))).StatusCode);
        using var request=new HttpRequestMessage(HttpMethod.Post,"/api/sequences/muscle"){Content=JsonContent.Create(new MuscleRequest("DNA",[]))};request.Headers.Add("Origin","https://other.example");Assert.Equal(HttpStatusCode.Forbidden,(await host.Client.SendAsync(request)).StatusCode);
    }
}
