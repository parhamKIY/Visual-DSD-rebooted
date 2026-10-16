using System.Net;
using System.Net.Http.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

public class WorkspaceTests(LocalHost host) : IClassFixture<LocalHost>
{
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
        foreach (string asset in new[] { "app.css", "app.js", "model.js", "chart.js", "icon.svg" })
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
