using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class AdvancedSolverTests
{
    const string Decay = "directive simulation {final=2;points=20;plots=[A]}\n" +
        "directive deterministic {abstolerance=1e-10;reltolerance=1e-8}\n| 10 A | A ->{0.5}";

    static SimulationData Run(string code, string solver = "source", string language = "crn")
    {
        var response = CoreEngine.Execute(new() { Code = code, Language = language, Operation = "simulate", Simulator = solver });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        return Assert.Single(response.Model!.Simulations);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Sundials_integrates_functional_rates_and_explicit_output_times(bool stiff)
    {
        string code = Decay.Replace("points=20", "points=20;times=[0.5;1;2]")
            .Replace("abstolerance=", $"stiff={stiff.ToString().ToLowerInvariant()};abstolerance=")
            .Replace("->{0.5}", "->[[A]*0.5]");
        var run = Run(code, "sundials");
        Assert.Equal(new[] { .5, 1, 2 }, run.Times);
        for (int i = 0; i < run.Times.Length; i++)
            Assert.InRange(Math.Abs(run.Series[0].Values[i] - 10 * Math.Exp(-.5 * run.Times[i])), 0, 2e-5);
    }

    [Theory]
    [InlineData("sundials")]
    [InlineData("cmesundials")]
    [InlineData("mc")]
    public void Original_source_directives_select_the_actual_solver_in_both_languages(string solver)
    {
        foreach (string language in new[] { "crn", "dsd" })
        {
            string code = language == "crn" ? Decay : ScientificTests.Decay;
            var run = Run($"directive simulator {solver}\n" + code, language: language);
            Assert.Equal(solver, run.Settings!.Simulator);
            Assert.NotEmpty(run.Times);
            Assert.All(run.Series, s => Assert.All(s.Values, v => Assert.True(double.IsFinite(v))));
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Native_CME_starts_at_initial_time_even_when_first_sample_is_later(bool stiff)
    {
        var run = Run(Decay.Replace("points=20", "points=20;times=[0.5;1;2]")
            .Replace("abstolerance=", $"stiff={stiff.ToString().ToLowerInvariant()};abstolerance="), "cmesundials");
        Assert.Equal(new[] { .5, 1, 2 }, run.Times);
        for (int i = 0; i < run.Times.Length; i++)
        {
            double p = Math.Exp(-.5 * run.Times[i]);
            Assert.InRange(Math.Abs(run.Series[0].Values[i] - 10 * p), 0, 2e-5);
            Assert.InRange(Math.Abs(run.Series[0].StandardDeviation![i] - Math.Sqrt(10 * p * (1 - p))), 0, 2e-5);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Moment_closure_matches_exact_binomial_first_and_second_moments(bool logEvaluation)
    {
        var run = Run($"directive moments {{order=2;plots=[<A>; <A^2>];log_evaluation={logEvaluation.ToString().ToLowerInvariant()}}}\n" +
            Decay.Replace("points=20", "points=200;times=[0.5;1;2]"), "mc");
        Assert.Equal(new[] { .5, 1, 2 }, run.Times);
        var mean = run.Series.Single(s => s.Name == "E[A]");
        var second = run.Series.Single(s => s.Name == "E[A^2]");
        Assert.Null(second.StandardDeviation);
        for (int i = 0; i < run.Times.Length; i++)
        {
            double p = Math.Exp(-.5 * run.Times[i]), variance = 10 * p * (1 - p);
            // The original Oslo path linearly interpolates between adaptive output rows.
            Assert.InRange(Math.Abs(mean.Values[i] - 10 * p), 0, .002);
            Assert.InRange(Math.Abs(mean.StandardDeviation![i] - Math.Sqrt(variance)), 0, .002);
            Assert.InRange(Math.Abs(second.Values[i] - (100 * p * p + variance)), 0, .01);
        }
    }

    [Fact]
    public void Nonlinear_closure_approximates_finite_CME_and_log_evaluation_agrees()
    {
        string code = Decay.Replace("A ->{0.5}", "A + A ->{0.05} A");
        var exact = Run(code, "cmesundials");
        var normal = Run("directive moments {order=3;plots=[<A>; <A^3>]}\n" + code, "mc");
        var log = Run("directive moments {order=3;plots=[<A>; <A^3>];log_evaluation=true}\n" + code, "mc");
        Assert.InRange(Math.Abs(normal.Series[0].Values[^1] - exact.Series[0].Values[^1]), 0, .15);
        Assert.InRange(Math.Abs(log.Series[0].Values[^1] - normal.Series[0].Values[^1]), 0, .01);
        Assert.True(normal.Series[1].Values[^1] > Math.Pow(normal.Series[0].Values[^1], 3));
    }

    [Theory]
    [InlineData("cmesundials")]
    [InlineData("mc")]
    public void Statistical_solvers_aggregate_repeated_initial_populations(string solver)
    {
        var run = Run("directive moments {order=2;plots=[<A>]}\n" + Decay.Replace("10 A", "3 A | 7 A"), solver);
        Assert.InRange(Math.Abs(run.Series[0].Values[^1] - 10 * Math.Exp(-1)), 0, .002);
    }

    [Theory]
    [InlineData("| 1 A | A ->{1} A + A", "cmesundials", "STATE_SPACE_LIMIT")]
    [InlineData("| 1 A @ 0.5", "mc", "STATISTICAL_EVENTS")]
    [InlineData("| constant 1 A", "mc", "MC_CONSTANTS")]
    [InlineData("| 1 A | A ->[[A]]", "mc", "MC_RATES")]
    [InlineData("directive moments {initial_minimum=0}\n| 1 A", "mc", "MC_INITIAL_MINIMUM")]
    [InlineData("directive deterministic {abstolerance=0}\n| 1 A", "sundials", "INVALID_TOLERANCE")]
    [InlineData("directive simulation {times=[0.5;0.25]}\n| 1 A", "cmesundials", "INVALID_OUTPUT_TIMES")]
    public void Unsupported_or_invalid_inputs_return_explicit_diagnostics(string code, string solver, string diagnostic)
    {
        var response = CoreEngine.Execute(new() { Code = code, Language = "crn", Operation = "simulate", Simulator = solver });
        Assert.False(response.Success);
        Assert.Equal(diagnostic, Assert.Single(response.Diagnostics).Code);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(100)]
    public void Symbolic_moment_order_is_bounded_before_expansion(int order)
    {
        var response = CoreEngine.Execute(new() { Code = $"directive simulator mc\ndirective moments {{order={order}}}\n| 1 A", Language = "crn", Operation = "simulate" });
        Assert.False(response.Success);
        Assert.Contains("order 1..8", Assert.Single(response.Diagnostics).Message);
    }

    [Fact]
    public void Small_moment_rates_do_not_overflow_integer_fraction_conversion()
    {
        var run = Run("directive moments {order=2;plots=[<A>]}\n" + Decay.Replace("0.5", "1e-12"), "mc");
        Assert.InRange(run.Series[0].Values[^1], 9.99999, 10.00001);
    }

    [Theory]
    [InlineData("sundials")]
    [InlineData("cmesundials")]
    [InlineData("mc")]
    public void New_solvers_preserve_named_runs_and_sweep_parameters(string solver)
    {
        string code = "directive parameters [k=0.5]\ndirective sweeps [rates=[k=[0.1;0.7]]]\n" +
            "directive simulations [early={initial=5;final=6};late={initial=5;final=7}]\n" +
            "directive moments {order=2;plots=[<A>]}\n" + Decay.Replace("0.5", "k");
        var response = CoreEngine.Execute(new() { Code = code, Language = "crn", Operation = "simulate", Simulator = solver });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        var runs = response.Model!.Simulations;
        Assert.Equal(4, runs.Length);
        Assert.All(runs, run => Assert.Equal(5, run.Times[0]));
        Assert.Equal(6, runs[0].Times[^1]); Assert.Equal(7, runs[3].Times[^1]);
        Assert.InRange(Math.Abs(runs[0].Series[0].Values[^1] - 10 * Math.Exp(-.1)), 0, .005);
        Assert.InRange(Math.Abs(runs[3].Series[0].Values[^1] - 10 * Math.Exp(-1.4)), 0, .005);
    }

    [Fact]
    public void First_order_closure_does_not_report_a_fabricated_zero_uncertainty()
    {
        var run = Run("directive moments {order=1;plots=[<A>]}\n" + Decay, "mc");
        Assert.Null(run.Series[0].StandardDeviation);
        Assert.InRange(Math.Abs(run.Series[0].Values[^1] - 10 * Math.Exp(-1)), 0, .005);
    }
}
