using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class JitBatchTests
{
    private const string Header = "directive jit\ndirective simulator stochastic\n";
    private const string Body = "dom a = {bind=k;unbind=0.1}\n( N * <a^ b> | N * {a^*}[b] )";

    private static ModelData Simulate(string code, double? final = null, int? seed = null)
    {
        var response = CoreEngine.Execute(new() { Code = code, Operation = "simulate", Final = final, Seed = seed });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        return response.Model!;
    }

    private static void EqualRun(SimulationData expected, SimulationData actual)
    {
        Assert.Equal(expected.Times, actual.Times);
        Assert.Equal(JsonSerializer.Serialize(expected.Series), JsonSerializer.Serialize(actual.Series));
        Assert.Equal(JsonSerializer.Serialize(expected.Network), JsonSerializer.Serialize(actual.Network));
    }

    [Fact]
    public void Sweeps_reparse_domain_rates_and_initials_and_match_separate_seeded_runs()
    {
        var model = Simulate(Header + "directive simulation {final=5;points=10;seed=17}\n" +
            "directive parameters [N=1;k=0.01]\ndirective sweeps [dose=[N=[2;4];k=[0.01;0.2]]]\n" + Body);
        Assert.Equal(4, model.Simulations.Length);
        foreach (var run in model.Simulations)
        {
            Assert.Equal("dose", run.Sweep);
            Assert.NotEmpty(run.Assignment);
            var network = Assert.IsType<NetworkData>(run.Network);
            Assert.All(network.Species, species => Assert.Equal("finalPopulation", species.ValueKind));
            var single = Simulate(Header + "directive simulation {final=5;points=10;seed=17}\n" +
                $"directive parameters {run.Assignment}\n" + Body);
            EqualRun(Assert.Single(single.Simulations), run);
        }
        Assert.Equal(JsonSerializer.Serialize(model.Species), JsonSerializer.Serialize(model.Simulations[0].Network!.Species));
        var repeated = Simulate(Header + "directive simulation {final=5;points=10;seed=17}\n" +
            "directive parameters [N=1;k=0.01]\ndirective sweeps [dose=[N=[2;4];k=[0.01;0.2]]]\n" + Body);
        Assert.Equal(JsonSerializer.Serialize(model), JsonSerializer.Serialize(repeated));
    }

    [Fact]
    public void Named_runs_select_sweeps_plots_times_and_seeds_independently()
    {
        var model = Simulate(Header + "directive parameters [N=1;k=0.1]\n" +
            "directive sweeps [small=[N=[2;3]];large=[N=[7]]]\n" +
            "directive simulations [early={final=1;points=3;seed=11;sweeps=[small];plots=[<a^ b>]};late={final=2;points=4;seed=22;sweeps=[large];plots=[{a^*}[b]]}]\n" + Body);
        Assert.Equal(new[] { "early", "early", "late" }, model.Simulations.Select(run => run.Name));
        Assert.Equal(new[] { "small", "small", "large" }, model.Simulations.Select(run => run.Sweep));
        Assert.Equal(new int?[] { 11, 11, 22 }, model.Simulations.Select(run => run.Seed));
        Assert.Equal(new double[] { 1, 1, 2 }, model.Simulations.Select(run => run.Settings!.Final));
        Assert.Equal(new[] { 3, 3, 4 }, model.Simulations.Select(run => run.Settings!.Points));
        Assert.All(model.Simulations, run => Assert.Single(run.Series));
        Assert.Equal(new double[] { 2, 3, 7 }, model.Simulations.Select(run => run.Series[0].Values[0]));
        var overridden = Simulate(Header + "directive simulations [a={final=1;seed=11};b={final=2;seed=22}]\n<a>", 3, 42);
        Assert.All(overridden.Simulations, run => { Assert.Equal(42, run.Seed); Assert.Equal(3, run.Settings!.Final); });
    }

    [Fact]
    public void Rules_JIT_sweeps_match_independent_runs()
    {
        const string rules = "directive rules { reaction([P],\"pol\",Q) :- P = C [b>], Q = C [b b>]. }\n( N * [<tb^ b>] )";
        var model = Simulate(Header + "directive simulation {final=2;points=4;seed=42}\n" +
            "directive parameters [N=2;pol=0.3]\ndirective sweeps [growth=[pol=[0;0.3]]]\n" + rules);
        Assert.Equal("rules", model.Kind);
        Assert.Equal(2, model.Simulations.Length);
        foreach (var run in model.Simulations)
        {
            var single = Simulate(Header + "directive simulation {final=2;points=4;seed=42}\n" +
                $"directive parameters [N=2;{run.Assignment.Trim('[', ']')}]\n" + rules);
            EqualRun(Assert.Single(single.Simulations), run);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Excessive_batches_are_rejected(bool jit)
    {
        string values = string.Join(';', Enumerable.Range(1, 257));
        var response = CoreEngine.Execute(new() { Code = (jit ? Header : "directive simulator stochastic\n") +
            $"directive parameters [N=1]\ndirective sweeps [s=[N=[{values}]]]\n<a>", Operation = "simulate" });
        Assert.False(response.Success);
        Assert.Contains("256", Assert.Single(response.Diagnostics).Message);
    }
}
