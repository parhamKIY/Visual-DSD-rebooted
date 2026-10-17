using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class ScientificTests
{
    internal const string Decay = "directive simulation {final=5;points=20;plots=[<a>]}\ndirective parameters [k=0.35]\n(10 * <a> | rxn <a> ->{k} <b>)";
    internal const string FitCode = "directive simulator deterministic\ndirective simulation {final=5;points=20;plots=[<a>]}\n" +
        "directive parameters [k=0.1, {interval=Real;distribution=Uniform(0.01,1);variation=Random}]\n" +
        "directive inference {burnin=200;samples=400;thin=5;seed=42;noise_parameter=Fixed(0.1)}\n" +
        "directive data [decay]\n(10 * <a> | rxn <a> ->{k} <b>)";
    internal static DatasetData[] Data => [new("decay", [new(Enumerable.Range(0, 11).Select(i => i * .5).ToArray(),
        [new("<a>", Enumerable.Range(0, 11).Select(i => 10 * Math.Exp(-.35 * i * .5)).ToArray())])])];

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    public void Statistical_solvers_match_the_analytic_binomial_decay_mean_and_standard_deviation(string simulator)
    {
        var result = CoreEngine.Execute(new() { Code = Decay, Operation = "simulate", Simulator = simulator });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        var run = Assert.Single(result.Model!.Simulations); var series = Assert.Single(run.Series);
        Assert.NotNull(series.StandardDeviation);
        for (int i = 0; i < run.Times.Length; i++)
        {
            double p = Math.Exp(-.35 * run.Times[i]);
            Assert.InRange(Math.Abs(series.Values[i] - 10 * p), 0, .005);
            Assert.InRange(Math.Abs(series.StandardDeviation![i] - Math.Sqrt(10 * p * (1 - p))), 0, .005);
        }
        Assert.Equal(simulator, run.Settings!.Simulator);
    }

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    public void Statistical_sweep_instances_honor_their_parameters_and_named_time_ranges(string simulator)
    {
        var result = CoreEngine.Execute(new() { Code = Decay.Replace("directive parameters [k=0.35]", "directive parameters [k=0.35]\ndirective sweeps [rates=[k=[0.1;0.7]]]\ndirective simulations [early={final=1};late={final=2}]") , Operation = "simulate", Simulator = simulator });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        Assert.Equal(4, result.Model!.Simulations.Length);
        var runs = result.Model.Simulations;
        Assert.InRange(Math.Abs(runs[0].Series[0].Values[^1] - 10 * Math.Exp(-.1)), 0, .01);
        Assert.InRange(Math.Abs(runs[3].Series[0].Values[^1] - 10 * Math.Exp(-1.4)), 0, .01);
        Assert.Equal(1, runs[0].Times[^1]); Assert.Equal(2, runs[3].Times[^1]);
    }

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    public void Compound_statistical_plots_are_rejected_instead_of_reporting_incorrect_uncertainty(string simulator)
    {
        var result = CoreEngine.Execute(new() { Code = Decay.Replace("plots=[<a>]", "plots=[([<a>] + [<b>])]"), Operation = "simulate", Simulator = simulator });
        Assert.False(result.Success); Assert.Equal("STATISTICAL_PLOTS", Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Unbounded_CME_networks_stop_at_the_state_limit()
    {
        var result = CoreEngine.Execute(new() { Code = "(1 * <a> | rxn <a> ->{1} <a> + <a>)", Operation = "simulate", Simulator = "cme" });
        Assert.False(result.Success); Assert.Contains("1000 states", Assert.Single(result.Diagnostics).Message);
    }

    [Fact]
    public void Seeded_inference_recovers_the_known_rate_and_returns_observations_and_posterior_samples()
    {
        var request = new ModelRequest { Code = FitCode, Operation = "infer", Data = Data };
        var result = CoreEngine.Execute(request);
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        var fit = Assert.IsType<InferenceData>(result.Model!.Inference);
        Assert.Equal(42, fit.Seed); Assert.Equal(11, fit.DataPoints);
        var parameter = Assert.Single(fit.Parameters.Where(p => p.Kind == "model"));
        Assert.Equal("k", parameter.Name); Assert.InRange(parameter.Mle, .33, .37);
        Assert.Equal(fit.RetainedSamples, parameter.Samples.Length);
        Assert.All(parameter.Samples, value => Assert.InRange(value, .01, 1));
        var curve = Assert.Single(result.Model.Simulations);
        Assert.Equal(Data[0].Tables[0].Times, curve.Times);
        for (int i = 0; i < curve.Times.Length; i++) Assert.InRange(Math.Abs(curve.Series[0].Values[i] - Data[0].Tables[0].Series[0].Values[i]), 0, .2);
        Assert.Single(fit.Observations);
        var repeated = CoreEngine.Execute(request);
        Assert.Equal(JsonSerializer.Serialize(result), JsonSerializer.Serialize(repeated));
    }

    [Theory]
    [InlineData("wrong-name")]
    [InlineData("wrong-column")]
    [InlineData("outside-time")]
    [InlineData("invalid-noise")]
    [InlineData("invalid-thin")]
    [InlineData("wrong-unit")]
    public void Invalid_inference_inputs_cannot_be_silently_fit(string problem)
    {
        var data = Data; string code = FitCode;
        if (problem == "wrong-name") data = [data[0] with { Name = "wrong" }];
        if (problem == "wrong-column") data[0].Tables[0].Series[0] = data[0].Tables[0].Series[0] with { Name = "unknown" };
        if (problem == "outside-time") data[0].Tables[0].Times[^1] = 6;
        if (problem == "invalid-noise") code = code.Replace("Fixed(0.1)", "Fixed(0)");
        if (problem == "invalid-thin") code = code.Replace("thin=5", "thin=0");
        if (problem == "wrong-unit") data[0].Tables[0] = data[0].Tables[0] with { TimeUnit = "min" };
        var result = CoreEngine.Execute(new() { Code = code, Operation = "infer", Data = data });
        Assert.False(result.Success); Assert.StartsWith("INFERENCE_", Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Observation_columns_are_matched_by_name_instead_of_position()
    {
        var data = Data;
        var table = data[0].Tables[0];
        data[0].Tables[0] = table with { Series = [new("<b>", table.Series[0].Values.Select(v => 10 - v).ToArray()), table.Series[0]] };
        var result = CoreEngine.Execute(new() { Code = FitCode.Replace("plots=[<a>]", "plots=[<a>;<b>]"), Operation = "infer", Data = data });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        var fit = result.Model!.Inference!;
        Assert.InRange(fit.Parameters.Single(p => p.Name == "k").Mle, .33, .37);
        Assert.Equal(10, fit.Observations[0].Series[0].Values[0]); Assert.Equal(0, fit.Observations[0].Series[1].Values[0]);
    }

    [Fact]
    public void Inference_sweeps_fit_each_observation_table_to_its_own_initial_population()
    {
        var table = Data[0].Tables[0];
        var data = new DatasetData[] { new("decay", [table, table with { Series = [table.Series[0] with { Values = table.Series[0].Values.Select(value => 2 * value).ToArray() }] }]) };
        var code = FitCode.Replace("[k=0.1,", "[N=10;k=0.1,").Replace("(10 * <a>", "(N * <a>").Replace("directive data [decay]", "directive data [decay]\ndirective sweeps [dose=[N=[10;20]]]");
        var result = CoreEngine.Execute(new() { Code = code, Operation = "infer", Data = data });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        Assert.Equal(2, result.Model!.Simulations.Length);
        Assert.Equal(10, result.Model.Simulations[0].Series[0].Values[0]); Assert.Equal(20, result.Model.Simulations[1].Series[0].Values[0]);
        Assert.InRange(result.Model.Inference!.Parameters.Single(p => p.Name == "k").Mle, .33, .37);
    }
}
