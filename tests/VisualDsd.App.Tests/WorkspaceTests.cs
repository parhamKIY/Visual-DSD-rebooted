using System.Net;
using System.Net.Http.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

[Collection("Process integration")]
public class WorkspaceTests(LocalHost host) : IClassFixture<LocalHost>
{
    [Theory]
    [InlineData("diffusion", "simulate")]
    [InlineData("state-switch", "analyze")]
    [InlineData("crn-systems", "simulate")]
    [InlineData("crn-graph", "simulate")]
    public async Task Spatial_and_state_examples_complete_through_the_isolated_worker(string id, string operation)
    {
        var example = (await host.Client.GetFromJsonAsync<ExampleModel>($"/api/examples/{id}"))!;
        var response = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest { Code = example.Code, Language = example.Language, Operation = operation });
        Assert.True(response.IsSuccessStatusCode);
        var created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        var finished = await host.FinishAsync(created.Id);
        Assert.Equal("succeeded", finished.State);
        var run = Assert.Single(finished.Result!.Model!.Simulations);
        if (operation == "analyze") { Assert.Equal(5, run.StateSpace!.States.Length); Assert.Equal(8, run.StateSpace.Transitions.Length); }
        else if (example.Language == "crn") { Assert.NotNull(finished.Result.Model.Program); Assert.Equal("crn", finished.Result.Model.Kind); Assert.NotEmpty(run.Times); }
        else { Assert.Equal(2, run.Spatial!.Dimensions); Assert.Equal(41, run.Times.Length); Assert.Equal(441, run.Spatial.Series[0].Frames[0].Length); }
    }

    [Fact]
    public async Task Linked_inference_example_includes_synthetic_data_and_completes_every_node_in_the_worker()
    {
        var example=(await host.Client.GetFromJsonAsync<ExampleModel>("/api/examples/inference-linked"))!;
        Assert.Equal(2,example.Data!.Length);
        var response=await host.Client.PostAsJsonAsync("/api/jobs",new ModelRequest{Code=example.Code,Language=example.Language,Operation="infer",NodeId="prediction",Data=example.Data});
        var created=(await response.Content.ReadFromJsonAsync<JobView>())!;
        var finished=await host.FinishAsync(created.Id);
        Assert.Equal("succeeded",finished.State);
        var model=finished.Result!.Model!;
        Assert.Equal(2,model.InferenceNodes!.Length);Assert.Equal(2,model.Inference!.Chains!.Length);
        Assert.Equal(80,model.Inference.RetainedSamples);
        Assert.InRange(model.Inference.Parameters.Single(p=>p.Name=="k").Mle,.32,.38);
        Assert.InRange(model.Inference.Parameters.Single(p=>p.Name=="h").Mle,.12,.18);
    }

    [Fact]
    public async Task CSV_import_and_parameter_inference_use_the_real_worker()
    {
        var data = ScientificTests.Data[0].Tables[0];
        string csv = "Time (s),<a>\n" + string.Join('\n', data.Times.Select((time, index) => $"{time.ToString("R", System.Globalization.CultureInfo.InvariantCulture)},{data.Series[0].Values[index].ToString("R", System.Globalization.CultureInfo.InvariantCulture)}"));
        var parsed = await host.Client.PostAsJsonAsync("/api/data/parse", new CsvDataRequest("decay", csv));
        Assert.True(parsed.IsSuccessStatusCode);
        var dataset = (await parsed.Content.ReadFromJsonAsync<DatasetData>())!;
        var response = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest { Code = ScientificTests.FitCode, Operation = "infer", Data = [dataset] });
        var created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        var finished = await host.FinishAsync(created.Id);
        Assert.Equal("succeeded", finished.State);
        Assert.InRange(finished.Result!.Model!.Inference!.Parameters.Single(p => p.Name == "k").Mle, .33, .37);
        var invalid = await host.Client.PostAsJsonAsync("/api/data/parse", new CsvDataRequest("decay", "Time,a\n0,1\n0,2"));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task JIT_batch_passes_through_the_real_worker_and_returns_distinct_run_networks()
    {
        HttpResponseMessage response = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest
        {
            Code = "directive jit\ndirective simulator stochastic\ndirective simulation {final=1;points=5;seed=42}\n" +
                   "directive parameters [N=1]\ndirective sweeps [dose=[N=[2;7]]]\nN * <a>", Operation = "simulate"
        });
        var created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        var finished = await host.FinishAsync(created.Id);
        Assert.Equal("succeeded", finished.State);
        var runs = finished.Result!.Model!.Simulations;
        Assert.Equal(2, runs.Length);
        Assert.Equal("2", Assert.Single(runs[0].Network!.Species).Initial);
        Assert.Equal("7", Assert.Single(runs[1].Network!.Species).Initial);
        Assert.All(runs, run => { Assert.Equal(42, run.Settings!.Seed); Assert.Equal(1, run.Times[^1]); });
    }

    [Fact]
    public async Task Workspace_assets_are_embedded_and_served_with_local_only_security_policy()
    {
        HttpResponseMessage page = await host.Client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Equal("text/html", page.Content.Headers.ContentType!.MediaType);
        Assert.Contains("id=\"editor\"", await page.Content.ReadAsStringAsync());
        Assert.Contains("script-src 'self'", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", page.Headers.GetValues("X-Content-Type-Options").Single());
        foreach (string asset in new[] { "sequences.js", "genbank.js", "sequence-workspace.js", "sequence-workspace.css", "app.css", "app.js", "model.js", "chart.js", "project.js", "network.js", "learning-guide.js", "learning-guide.css", "logic-study.js","logic-study-workspace.js","course-export.js","course-report.js","adleman.js","adleman-workspace.js","logic-analysis.js","logic-inspector.js","logic.js","logic-workspace.js","logic-workspace.css","logic-example.json","student-workspace.js", "student-workspace.css", "msagl.worker.js", "msagl.runtime.js", "observations.js", "exploration.js", "icon.svg" })
        {
            HttpResponseMessage response = await host.Client.GetAsync($"/assets/{asset}");
            Assert.True(response.IsSuccessStatusCode, asset);
            Assert.True((await response.Content.ReadAsByteArrayAsync()).Length > 100);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client.GetAsync("/assets/Program.cs")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client.GetAsync("/api/examples/missing")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client.GetAsync("/api/missing")).StatusCode);
    }

    [Theory]
    [InlineData("catalytic", "Examples/DSDModels/Catalytic.txt", "current")]
    [InlineData("and-gate", "Examples/DSDModels/Simple - AND Circuit.txt", "current")]
    [InlineData("transducer", "Examples/DSDModels/2-domain, DCM - Two-domain transducer.txt", "current")]
    [InlineData("join", "Examples/DSDModels/Manual/Join.txt", "current")]
    [InlineData("jit", "Examples/DSDModels/Manual/Join-JIT.txt", "current")]
    [InlineData("legacy-and", "ClassicDSDTests/testData/visualDsd/Simple - AND Circuit.vdsd", "legacy")]
    public async Task Example_library_preserves_original_source_and_runs_through_the_real_worker(string id, string source, string dialect)
    {
        ExampleModel example = (await host.Client.GetFromJsonAsync<ExampleModel>($"/api/examples/{id}"))!;
        string original = await File.ReadAllTextAsync(Path.Combine(LocalHost.Root, "upstream", "crn-engine", "ClassicDSD", source));
        Assert.Equal(original, example.Code);
        Assert.Equal(dialect, example.Dialect);
        Assert.Contains((await host.Client.GetFromJsonAsync<ExampleInfo[]>("/api/examples"))!, item => item.Id == id);
        HttpResponseMessage response = await host.Client.PostAsJsonAsync("/api/jobs", new ModelRequest
        {
            Code = example.Code, Dialect = example.Dialect, Operation = "simulate",
            Simulator = id == "jit" ? "ssa" : "oslo", Final = 1, Points = 5, Seed = 42
        });
        JobView created = (await response.Content.ReadFromJsonAsync<JobView>())!;
        JobView finished = await host.FinishAsync(created.Id);
        Assert.Equal("succeeded", finished.State);
        Assert.NotEmpty(finished.Result!.Model!.Simulations);
        Assert.All(finished.Result.Model.Simulations, run => Assert.Equal(42, run.Seed));
    }
}
