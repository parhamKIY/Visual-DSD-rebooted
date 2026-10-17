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
        Assert.Equal("BATCH_TOO_LARGE", Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public void Dynamically_discovered_species_are_kept_in_the_result_table()
    {
        var model = Simulate(Header + "directive simulation {final=2;points=20;seed=42}\n" +
            "directive parameters [pol=10]\ndirective rules { reaction([P],\"pol\",Q) :- P = C [b>], Q = C [b b>]. }\n( 2 * [<tb^ b>] )");
        var run = Assert.Single(model.Simulations);
        Assert.True(run.Network!.Species.Length > 2);
        foreach (var species in run.Network.Species.Where(species => double.Parse(species.Initial, System.Globalization.CultureInfo.InvariantCulture) > 0))
            Assert.Contains(run.Series, series => series.Name == species.Name);
        Assert.All(run.Series, series => Assert.Equal(run.Times.Length, series.Values.Length));
    }

    [Theory]
    [InlineData(0, 0.000001)]
    [InlineData(5, 6)]
    public void JIT_respects_time_bounds_and_does_not_execute_a_reaction_after_final_time(double initial, double final)
    {
        var response = CoreEngine.Execute(new() { Code = Header + "directive parameters [N=2;k=0.01]\n" + Body,
            Operation = "simulate", Initial = initial, Final = final, Points = 10, Seed = 42 });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        var run = Assert.Single(response.Model!.Simulations);
        Assert.Equal(initial, run.Times[0]);
        Assert.Equal(final, run.Times[^1]);
        Assert.All(run.Times, time => Assert.InRange(time, initial, final));
        if (initial == 0)
            Assert.Equal(2, double.Parse(run.Network!.Species.Single(species => species.Structure == "<a^ b>").Initial, System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public void Timed_inputs_are_applied_at_their_own_time_and_future_inputs_remain_scheduled()
    {
        var model = Simulate(Header + "directive simulation {initial=5;final=10;points=10;seed=42}\n" +
            "( 1 * <a> | 3 * <a> @ 7 | 9 * <a> @ 20 )");
        var run = Assert.Single(model.Simulations);
        Assert.Equal(5, run.Times[0]); Assert.Equal(10, run.Times[^1]);
        var series = Assert.Single(run.Series);
        Assert.Equal(1, series.Values[0]); Assert.Equal(4, series.Values[^1]);
        Assert.All(run.Times.Select((time, index) => (time, value: series.Values[index])), pair =>
            Assert.Equal(pair.time < 7 ? 1 : 4, pair.value));
        Assert.Contains(run.Network!.Species, species => species.ValueKind == "scheduledInput" && species.Initial == "9" && species.Time == "10");
    }

    [Fact]
    public void A_timed_input_restarts_reaction_propensities()
    {
        var model = Simulate(Header + "directive simulation {final=1;points=20;seed=42}\n" +
            "directive parameters [N=2;k=100]\ndom a = {bind=k;unbind=0.1}\n( 0 * <a^ b> | 2 * <a^ b> @ 0.5 | 2 * {a^*}[b] )");
        var run = Assert.Single(model.Simulations);
        Assert.Equal(1, run.Times[^1]);
        Assert.Contains(run.Network!.Species, species => species.Structure == "<a^ b>" && species.Initial == "0");
    }
}
