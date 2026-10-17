using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class ExplorationTests
{
    internal const string Spatial = "directive simulator pde\ndirective simulation {initial=2;final=3;points=10;plots=[<a>]}\ndirective spatial {dimensions=1;boundary=Periodic;nx=11;xmax=2;dt=0.007;default_diffusion=0.1}\n(10 * <a> | rxn <a> ->{0.35} <b>)";
    static SimulationData Run(string code, string operation = "simulate")
    {
        var result = CoreEngine.Execute(new() { Code = code, Operation = operation });
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        return Assert.Single(result.Model!.Simulations);
    }

    [Fact]
    public void Spatial_fields_are_identified_instead_of_being_reported_as_a_scalar_initial_population()
    {
        var result = CoreEngine.Execute(new() { Code = "directive simulator pde\ndirective simulation {final=0.1;points=2;plots=[<a>]}\ndirective spatial {nx=5;dt=0.01}\n<a> = {spatial={centralcore={inner=3;outer=0;width=0.2}}}", Operation = "simulate" });
        Assert.True(result.Success, JsonSerializer.Serialize(result)); Assert.Equal("spatial", Assert.Single(result.Model!.Species).ValueKind);
        Assert.Equal(new double[] { 0, 0, 3, 0, 0 }, result.Model.Simulations[0].Spatial!.Series[0].Frames[0]);
    }

    [Theory]
    [InlineData(1, "Periodic")]
    [InlineData(1, "ZeroFlux")]
    [InlineData(2, "Periodic")]
    [InlineData(2, "ZeroFlux")]
    public void Spatial_uniform_decay_matches_analytic_solution_and_exact_time_bounds(int dimensions, string boundary)
    {
        var run = Run(Spatial.Replace("dimensions=1", $"dimensions={dimensions}").Replace("Periodic", boundary));
        var grid = run.Spatial!;
        Assert.Equal(dimensions, grid.Dimensions); Assert.Equal(boundary, grid.Boundary);
        Assert.Equal(11, grid.X.Length); Assert.Equal(dimensions == 1 ? 0 : 11, grid.Y.Length); Assert.Equal(2, grid.X[^1]);
        Assert.Equal(11, run.Times.Length); Assert.Equal(2, run.Times[0]); Assert.Equal(3, run.Times[^1]); Assert.InRange(grid.Dt, .006, .007);
        for (int i = 0; i < run.Times.Length; i++)
            Assert.All(grid.Series[0].Frames[i], value => Assert.InRange(Math.Abs(value - 10 * Math.Exp(-.35 * (run.Times[i] - 2))), 0, .005));
        Assert.Equal(grid.Series[0].Frames[^1].Average(), run.Series[0].Values[^1], 10);
    }

    [Theory]
    [InlineData(1, "Periodic")]
    [InlineData(1, "ZeroFlux")]
    [InlineData(2, "Periodic")]
    [InlineData(2, "ZeroFlux")]
    public void Diffusion_spreads_a_local_pulse_without_changing_total_population(int dimensions, string boundary)
    {
        var run = Run(Spatial.Replace("dimensions=1", $"dimensions={dimensions}").Replace("Periodic", boundary)
            .Replace("(10 * <a> | rxn <a> ->{0.35} <b>)", "(<a> = {spatial={points=[{x=0.5;y=0.5;width=0.3;value=10}]}})"));
        var grid = run.Spatial!; var frames = grid.Series[0].Frames;
        int n = boundary == "Periodic" ? 10 : 11;
        double Sum(double[] values) => Enumerable.Range(0, n).Sum(x => dimensions == 1 ? values[x] : Enumerable.Range(0, n).Sum(y => values[x * 11 + y]));
        Assert.InRange(Math.Abs(Sum(frames[0]) - Sum(frames[^1])), 0, .000001);
        Assert.True(frames[^1].Max() < frames[0].Max()); Assert.True(frames[^1].Min() > frames[0].Min());
        Assert.Equal(0, frames[0][0]); Assert.True(frames[^1][0] > 0);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void Periodic_diffusion_matches_the_analytic_Fourier_mode(int dimensions)
    {
        const int n = 21; const double d = .1, final = .2;
        var points = from x in Enumerable.Range(0, n) from y in Enumerable.Range(0, dimensions == 1 ? 1 : n)
                     let value = 2 + Math.Cos(2 * Math.PI * x / (n - 1)) + (dimensions == 1 ? 0 : .3 * Math.Cos(2 * Math.PI * y / (n - 1)))
                     select FormattableString.Invariant($"{{x={(double)x / (n - 1):R};y={(double)y / (n - 1):R};width=0;value={value:R}}}");
        string code = $"directive simulator pde\ndirective simulation {{final=0.2;points=2;plots=[<a>]}}\ndirective spatial {{dimensions={dimensions};boundary=Periodic;nx=21;xmax=1;dt=0.0001;default_diffusion=0.1}}\n<a> = {{spatial={{points=[{string.Join(';', points)}]}}}}";
        var values = Run(code).Spatial!.Series[0].Frames[^1];
        for (int x = 0; x < n; x++) for (int y = 0; y < (dimensions == 1 ? 1 : n); y++)
        {
            double expected = 2 + Math.Exp(-4 * Math.PI * Math.PI * d * final) * (Math.Cos(2 * Math.PI * x / (n - 1)) + (dimensions == 1 ? 0 : .3 * Math.Cos(2 * Math.PI * y / (n - 1))));
            Assert.InRange(Math.Abs(values[dimensions == 1 ? x : x * n + y] - expected), 0, .005);
        }
    }

    [Fact]
    public void Zero_diffusion_default_dt_is_finite_and_spatial_sweeps_are_independent()
    {
        var result = CoreEngine.Execute(new() { Code = Spatial.Replace("dt=0.007;default_diffusion=0.1", "default_diffusion=0")
            .Replace("(10 *", "directive parameters [N=1]\ndirective sweeps [dose=[N=[10;20]]]\n(N *"), Operation = "simulate" });
        Assert.True(result.Success, JsonSerializer.Serialize(result)); Assert.Equal(2, result.Model!.Simulations.Length);
        Assert.Equal(10, result.Model.Simulations[0].Spatial!.Series[0].Frames[0][0]); Assert.Equal(20, result.Model.Simulations[1].Spatial!.Series[0].Frames[0][0]);
        Assert.All(result.Model.Simulations, run => Assert.True(double.IsFinite(run.Spatial!.Dt)));
    }

    [Theory]
    [InlineData("nx=11", "nx=3", "SPATIAL_SETTINGS")]
    [InlineData("dimensions=1", "dimensions=3", "SPATIAL_SETTINGS")]
    [InlineData("dt=0.007", "dt=-1", "SPATIAL_SETTINGS")]
    [InlineData("default_diffusion=0.1", "default_diffusion=-1", "SPATIAL_DIFFUSION")]
    [InlineData("points=10", "points=5001", "SPATIAL_LIMIT")]
    [InlineData("dt=0.007", "dt=0.000000001", "SPATIAL_LIMIT")]
    public void Unsafe_spatial_settings_fail_explicitly(string from, string to, string diagnostic)
    {
        var result = CoreEngine.Execute(new() { Code = Spatial.Replace(from, to), Operation = "simulate" });
        Assert.False(result.Success); Assert.Equal(diagnostic, Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Spatial_dt_metadata_uses_active_species_diffusion_instead_of_an_unused_default()
    {
        var run = Run(Spatial.Replace("dt=0.007;default_diffusion=0.1", "diffusibles=[<a>=0;<b>=0];default_diffusion=1000"));
        Assert.Equal(.01, run.Spatial!.Dt, 12);
    }

    [Fact]
    public void State_space_decay_has_exact_populations_rates_and_an_absorbing_state()
    {
        var graph = Run("(2 * <a> | 3 * <a> | rxn <a> ->{0.35} <b>)", "analyze").StateSpace!;
        Assert.Equal(6, graph.States.Length); Assert.Equal(5, graph.Transitions.Length);
        Assert.Equal(5, graph.States[graph.InitialState].Sum());
        Assert.All(graph.States, values => Assert.Equal(5, values.Sum()));
        for (int i = 0; i < 5; i++) { var edge = graph.Transitions.Single(t => t.Source == i); Assert.Equal(i + 1, edge.Target); Assert.Equal(.35 * (5 - i), edge.Rate, 10); }
        Assert.DoesNotContain(graph.Transitions, t => t.Source == 5);
    }

    [Fact]
    public void Parallel_reactions_are_aggregated_and_zero_rate_reactions_are_excluded()
    {
        var graph = Run("directive parameters [k=0]\n(1 * <a> | 1 * <c> | rxn <a> ->{1} <b> | rxn <a> + <c> ->{2} <b> + <c> | rxn <a> ->{k} <a> + <a>)", "analyze").StateSpace!;
        Assert.Equal(2, graph.States.Length); Assert.Equal(3, Assert.Single(graph.Transitions).Rate);
    }

    [Fact]
    public void State_exploration_sweeps_use_each_parameters_value()
    {
        var result = CoreEngine.Execute(new() { Code = "directive parameters [k=1]\ndirective sweeps [rates=[k=[0;2]]]\n(1 * <a> | rxn <a> ->{k} <b>)", Operation = "analyze" });
        Assert.True(result.Success, JsonSerializer.Serialize(result)); var runs = result.Model!.Simulations;
        Assert.Equal(2, runs.Length); Assert.Single(runs[0].StateSpace!.States); Assert.Equal(2, Assert.Single(runs[1].StateSpace!.Transitions).Rate);
    }

    [Theory]
    [InlineData("(1 * <a> | rxn <a> ->{1} <a> + <a>)", "STATE_SPACE_LIMIT")]
    [InlineData("(1.5 * <a>)", "STATE_SPACE_INITIALS")]
    [InlineData("(1 * <a> | rxn <a> ->{-1} <b>)", "STATE_SPACE_RATE")]
    public void Invalid_or_infinite_state_spaces_never_return_a_partial_success(string code, string diagnostic)
    {
        var result = CoreEngine.Execute(new() { Code = code, Operation = "analyze" });
        Assert.False(result.Success); Assert.Null(result.Model); Assert.Equal(diagnostic, Assert.Single(result.Diagnostics).Code);
    }
}
