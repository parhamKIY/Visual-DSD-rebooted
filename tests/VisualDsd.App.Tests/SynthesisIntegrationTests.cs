using System.Net.Http.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

[Collection("Process integration")]
public class SynthesisIntegrationTests(LocalHost host):IClassFixture<LocalHost>
{
    [Theory]
    [InlineData("synthesis-bistable",2)]
    [InlineData("synthesis-turing",1)]
    public async Task Embedded_examples_execute_through_an_isolated_worker(string id,int equilibria)
    {
        var example=await host.Client.GetFromJsonAsync<ExampleModel>("/api/examples/"+id);
        Assert.NotNull(example);
        var admitted=await host.Client.PostAsJsonAsync("/api/jobs",new ModelRequest{Code=example!.Code,Language="crn",Operation="synthesize",PhaseTrajectories=2});
        admitted.EnsureSuccessStatusCode();
        var job=await admitted.Content.ReadFromJsonAsync<JobView>();
        var finished=await host.FinishAsync(job!.Id);Assert.Equal("succeeded",finished.State);
        var result=finished.Result!.Model!.Synthesis!;Assert.Equal("SAT",result.Status);Assert.Equal(equilibria,result.Equilibria.Length);
        if(equilibria==2)Assert.Equal(2,result.PhasePortrait!.Trajectories.Length);else Assert.True(result.Dispersion!.WitnessGrowthRate>0);
        Assert.Contains("directive synthesis",result.Code);
        Assert.Contains("Synthesis",await host.Client.GetStringAsync("/"));
        Assert.Contains("readSynthesis",await host.Client.GetStringAsync("/assets/synthesis.js"));
    }
}
