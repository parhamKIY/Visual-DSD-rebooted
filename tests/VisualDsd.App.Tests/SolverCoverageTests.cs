using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class SolverCoverageTests
{
    const string Decay = "directive simulation {initial=2;final=4;points=100;times=[2;2.3;3;4];plots=[A;B]}\ndirective deterministic {abstolerance=1e-10;reltolerance=1e-8}\n| 10 A | A ->{0.35} B";
    static SimulationData Run(string code, string solver)
    {
        var result = CoreEngine.Execute(new() { Code = code, Language = "crn", Simulator = solver, Operation = "simulate" });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        return Assert.Single(result.Model!.Simulations);
    }

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Positive_scaling_and_duplicate_initials_preserve_original_copy_population_convention(string solver)
    {
        var run = Run("directive stochastic {scale=2}\n" + Decay.Replace("| 10 A", "| 2 A | 3 A"), solver);
        Assert.Equal(new double[] { 2, 2.3, 3, 4 }, run.Times);
        for (int t = 0; t < run.Times.Length; t++)
        {
            double p = Math.Exp(-.35 * (run.Times[t] - 2));
            Assert.InRange(Math.Abs(run.Series[0].Values[t] - 10 * p), 0, .002);
            Assert.InRange(Math.Abs(run.Series[0].StandardDeviation![t] - Math.Sqrt(10 * p * (1 - p))), 0, .002);
        }
    }

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Affine_observables_include_cross_species_covariances(string solver)
    {
        var run = Run(Decay.Replace("plots=[A;B]", "plots=[([A]+[B]);([A]-[B]);(2*[A]+3)]"), solver);
        for (int t = 0; t < run.Times.Length; t++)
        {
            double p = Math.Exp(-.35 * (run.Times[t] - 2)), sd = Math.Sqrt(10 * p * (1 - p));
            Assert.InRange(Math.Abs(run.Series[0].Values[t] - 10), 0, 1e-8);
            Assert.InRange(run.Series[0].StandardDeviation![t], 0, 1e-6);
            Assert.InRange(Math.Abs(run.Series[1].Values[t] - (20 * p - 10)), 0, .004);
            Assert.InRange(Math.Abs(run.Series[1].StandardDeviation![t] - 2 * sd), 0, .004);
            Assert.InRange(Math.Abs(run.Series[2].Values[t] - (20 * p + 3)), 0, .004);
        }
    }

    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Nonlinear_CME_observables_use_expectations_over_joint_states(string solver)
    {
        var run = Run(Decay.Replace("plots=[A;B]", "plots=[([A]^2);([A]*[B]);([time]+[A])]"), solver);
        for (int t = 0; t < run.Times.Length; t++)
        {
            double p = Math.Exp(-.35 * (run.Times[t] - 2));
            double second = 90*p*p + 10*p, fourth = 5040*Math.Pow(p,4) + 4320*Math.Pow(p,3) + 630*p*p + 10*p;
            Assert.InRange(Math.Abs(run.Series[0].Values[t] - second), 0, .04);
            Assert.InRange(Math.Abs(run.Series[0].StandardDeviation![t] - Math.Sqrt(Math.Max(0, fourth-second*second))), 0, .04);
            Assert.InRange(Math.Abs(run.Series[1].Values[t] - 90*p*(1-p)), 0, .04);
            Assert.InRange(Math.Abs(run.Series[2].Values[t] - (run.Times[t]+10*p)), 0, .01);
        }
    }

    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Finite_networks_larger_than_previous_thousand_state_limit_run_without_truncation(string solver)
    {
        var run = Run("directive simulation {final=0.01;points=1;plots=[A]}\n| 1001 A | A ->{0.1} B", solver);
        Assert.Equal(1002, run.Probabilities!.States.Length);
        Assert.InRange(Math.Abs(run.Series[0].Values[^1] - 1001*Math.Exp(-.001)), 0, .01);
        Assert.All(run.Probabilities.Mass, row => Assert.InRange(Math.Abs(row.Sum()-1), 0, 1e-10));
    }

    [Theory]
    [InlineData("lna", "plots=[([A]^2)]", "LNA_PLOTS")]
    [InlineData("lna", "scale=0", "STATISTICAL_SCALE")]
    [InlineData("cme", "scale=-1", "STATISTICAL_SCALE")]
    [InlineData("cmesundials", "scale=0.15", "CME_INITIALS")]
    [InlineData("cme", "times=[1;3]", "INVALID_OUTPUT_TIMES")]
    [InlineData("lna", "times=[3;2]", "INVALID_OUTPUT_TIMES")]
    public void Unsupported_or_invalid_settings_fail_before_integrating(string solver, string setting, string diagnostic)
    {
        string code = setting.StartsWith("scale") ? "directive stochastic {"+setting+"}\n"+Decay : setting.StartsWith("plots") ? Decay.Replace("plots=[A;B]",setting) : Decay.Replace("times=[2;2.3;3;4]",setting);
        var result = CoreEngine.Execute(new() { Code=code, Language="crn", Simulator=solver, Operation="simulate" });
        Assert.False(result.Success); Assert.Null(result.Model); Assert.Equal(diagnostic, Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void LNA_without_reactions_has_no_fabricated_noise()
    {
        var run = Run("directive simulation {final=1;points=3;plots=[A]}\n| 4 A", "lna");
        Assert.All(run.Series[0].Values, v => Assert.Equal(4,v));
        Assert.All(run.Series[0].StandardDeviation!, v => Assert.Equal(0,v));
    }

    [Theory]
    [InlineData(1,129)]
    [InlineData(2,65)]
    public void Larger_spatial_grids_and_nonuniform_requested_times_preserve_uniform_solution(int dimensions, int nx)
    {
        var run = Run($"directive simulation {{initial=2;final=3;points=10;times=[2;2.25;2.25;2.7;3];plots=[A]}}\ndirective spatial {{dimensions={dimensions};nx={nx};dt=0.01;default_diffusion=0}}\n| 10 A | A ->{{0.35}} B", "pde");
        Assert.Equal(new double[] {2,2.25,2.25,2.7,3},run.Times);
        Assert.Equal(nx,run.Spatial!.X.Length);
        Assert.Equal(run.Spatial.Series[0].Frames[1],run.Spatial.Series[0].Frames[2]);
        for(int t=0;t<run.Times.Length;t++) Assert.All(run.Spatial.Series[0].Frames[t],value => Assert.InRange(Math.Abs(value-10*Math.Exp(-.35*(run.Times[t]-2))),0,.01));
    }

    [Fact]
    public void Spatial_plots_inline_named_rates_before_selecting_species()
    {
        var run = Run("directive simulation {final=0.1;points=2;plots=[[report]]}\ndirective rates [report=2*[B]+[time]]\ndirective spatial {nx=5;dt=0.01;default_diffusion=0}\n| 10 A | 3 B | A ->{0.35} C", "pde");
        Assert.All(run.Spatial!.Series[0].Frames[^1],v => Assert.InRange(Math.Abs(v-6.1),0,1e-10));
    }
    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Named_time_dependent_plots_are_distinct_from_time_dependent_reaction_rates(string solver)
    {
        var run = Run(Decay.Replace("directive deterministic", "directive rates [report=[time]+[A]]\ndirective deterministic").Replace("plots=[A;B]", "plots=[[report]]"), solver);
        Assert.Equal(12, run.Series[0].Values[0], 8);
        var invalid = CoreEngine.Execute(new() { Language="crn", Simulator=solver, Operation="simulate", Code="directive simulation {final=1;points=2}\ndirective rates [k=[time]+1]\n| 2 A | A ->[[k]*[A]] B" });
        Assert.False(invalid.Success); Assert.Equal("CME_RATE", Assert.Single(invalid.Diagnostics).Code);
    }

    [Fact]
    public void LNA_keeps_constant_species_noise_free()
    {
        var run = Run("directive simulation {final=1;points=10;plots=[A;B]}\n| constant 3 A | 0 B | A ->{0.5} B", "lna");
        Assert.All(run.Series[0].Values,v=>Assert.Equal(3,v));
        Assert.All(run.Series[0].StandardDeviation!,v=>Assert.Equal(0,v));
        Assert.InRange(Math.Abs(run.Series[1].Values[^1]-1.5),0,.001);
        Assert.InRange(Math.Abs(run.Series[1].StandardDeviation![^1]-Math.Sqrt(1.5)),0,.001);
    }

    [Theory]
    [InlineData("lna")]
    [InlineData("cme")]
    public void Conflicting_constant_declarations_cannot_be_erased_by_initial_aggregation(string solver)
    {
        var invalid = CoreEngine.Execute(new() { Language="crn", Simulator=solver, Operation="simulate", Code="directive simulation {final=1;points=2}\n| 2 A | constant 3 A | A ->{0.5} B" });
        Assert.False(invalid.Success); Assert.Equal("STATISTICAL_INITIALS", Assert.Single(invalid.Diagnostics).Code);
    }

    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Dense_stiff_CME_size_is_checked_before_allocating_solver_matrices(string solver)
    {
        var invalid=CoreEngine.Execute(new() { Language="crn", Simulator=solver, Operation="simulate", Code="directive deterministic {stiff=true}\ndirective simulation {final=0.01;points=1;plots=[A]}\n| 2048 A | A ->{0.1} B" });
        Assert.False(invalid.Success); Assert.Null(invalid.Model);
        Assert.Equal("STATE_SPACE_LIMIT",Assert.Single(invalid.Diagnostics).Code); Assert.Contains("2048",invalid.Diagnostics[0].Message);
    }

}
