using System.Text.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class EngineTests
{
    internal static string Catalytic => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "Catalytic.txt"));

    [Fact]
    public void Expand_preserves_the_reference_catalytic_network()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = Catalytic, Operation = "expand" });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal(9, response.Model!.Species.Length);
        Assert.Equal(4, response.Model.Reactions.Length);
        Assert.All(response.Model.Species, species => Assert.Contains("<svg", species.Svg));
        var ids = response.Model.Species.Select(s => s.Id).ToHashSet();
        Assert.All(response.Model.Reactions.SelectMany(r => r.Reactants.Concat(r.Products).Concat(r.Catalysts)), p => Assert.Contains(p.SpeciesId, ids));
    }

    [Theory]
    [InlineData("default")]
    [InlineData("detailed")]
    [InlineData("finite")]
    [InlineData("infinite")]
    public void Compilation_mode_is_applied(string mode)
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = Catalytic, Operation = "expand", Compilation = mode });
        Assert.True(response.Success);
        Assert.Equal(mode, response.Model!.Compilation);
        Assert.NotEmpty(response.Model.Reactions);
    }

    [Fact]
    public void Legacy_conversion_retains_the_AND_network()
    {
        string code = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "And.vdsd"));
        EngineResponse response = CoreEngine.Execute(new() { Code = code, Dialect = "legacy", Operation = "expand" });
        Assert.True(response.Success);
        Assert.Equal(7, response.Model!.Species.Length);
        Assert.Equal(4, response.Model.Reactions.Length);
    }

    [Theory]
    [InlineData("oslo")]
    [InlineData("ssa")]
    public void Simulation_respects_requested_settings_and_returns_finite_series(string simulator)
    {
        var request = new ModelRequest { Code = Catalytic, Operation = "simulate", Simulator = simulator, Initial = 0, Final = 100, Points = 20, Seed = 42 };
        EngineResponse response = CoreEngine.Execute(request);
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal(simulator, response.Model!.Settings.Simulator);
        Assert.Equal(100, response.Model.Settings.Final);
        Assert.Equal(20, response.Model.Settings.Points);
        SimulationData simulation = Assert.Single(response.Model.Simulations);
        Assert.True(simulation.Times.Length >= 2);
        Assert.All(simulation.Times, t => Assert.InRange(t, 0, 100.000001));
        Assert.All(simulation.Series, series =>
        {
            Assert.Equal(simulation.Times.Length, series.Values.Length);
            Assert.All(series.Values, value => Assert.True(double.IsFinite(value)));
        });
        EngineResponse repeated = CoreEngine.Execute(request);
        Assert.Equal(JsonSerializer.Serialize(response), JsonSerializer.Serialize(repeated));
    }

    [Fact]
    public void Syntax_diagnostics_include_editor_positions()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "<a^" });
        Assert.False(response.Success);
        Assert.Contains(response.Diagnostics, d => d.Code == "PARSE_ERROR" && d.Line >= 1 && d.Column >= 1);
    }

    [Fact]
    public void Auto_detects_the_legacy_marker()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "//old_syntax\ndirective sample 10 10\n(<a>)" });
        Assert.True(response.Success);
        Assert.Equal("legacy", response.Dialect);
    }

    [Theory]
    [InlineData("parse")]
    [InlineData("expand")]
    [InlineData("simulate")]
    public void Pasted_old_syntax_without_a_marker_is_detected_and_preserves_explicit_legacy_results(string operation)
    {
        const string code = "directive duration 1 points 10\ndirective plot <a>\ndef N = 3\n(N * <a>)";
        var request = new ModelRequest { Code = code, Operation = operation, Simulator = "oslo" };
        var automatic = CoreEngine.Execute(request);
        var explicitLegacy = CoreEngine.Execute(request with { Dialect = "legacy" });
        Assert.True(automatic.Success, JsonSerializer.Serialize(automatic));
        Assert.Equal("legacy", automatic.Dialect);
        Assert.Equal(JsonSerializer.Serialize(explicitLegacy), JsonSerializer.Serialize(automatic));
        Assert.Equal(3, double.Parse(Assert.Single(automatic.Model!.Species).Initial, System.Globalization.CultureInfo.InvariantCulture));
        var explicitCurrent = CoreEngine.Execute(request with { Dialect = "current" });
        Assert.False(explicitCurrent.Success); Assert.Equal("current", explicitCurrent.Dialect);
    }

    [Fact]
    public void Commented_old_directives_do_not_reinterpret_a_valid_current_program()
    {
        var result = CoreEngine.Execute(new() { Code = "(* directive duration 3600 points 1000\n directive plot <missing> *)\ndirective simulation {final=2;points=10}\n<a>" });
        Assert.True(result.Success, JsonSerializer.Serialize(result)); Assert.Equal("current", result.Dialect);
        Assert.Equal(2, result.Model!.Settings.Final);
    }

    [Fact]
    public void JIT_is_simulated_without_forcing_full_expansion()
    {
        const string code = "directive jit\ndirective polymers\ndirective simulator stochastic\n(<a^ b> | {a^*}[b])";
        EngineResponse expanded = CoreEngine.Execute(new() { Code = code, Operation = "expand" });
        Assert.False(expanded.Success);
        Assert.Equal("JIT_EXPANSION", Assert.Single(expanded.Diagnostics).Code);
        EngineResponse simulated = CoreEngine.Execute(new() { Code = code, Operation = "simulate", Final = 10, Points = 10, Seed = 42 });
        Assert.True(simulated.Success, JsonSerializer.Serialize(simulated));
        Assert.True(simulated.Model!.IsJit);
        Assert.NotEmpty(Assert.Single(simulated.Model.Simulations).Times);
        Assert.All(simulated.Model.Species, species => Assert.Contains(species.ValueKind, new[] { "finalPopulation", "scheduledInput" }));
    }

    [Fact]
    public void Source_native_simulator_is_executed_without_an_override()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "directive simulator sundials\n<a>", Operation = "simulate" });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal("sundials", response.Model!.Settings.Simulator);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(100001)]
    public void Point_limits_are_enforced_before_simulation(int points)
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = Catalytic, Operation = "simulate", Points = points });
        Assert.False(response.Success);
        Assert.Contains(response.Diagnostics, d => d.Code == "INVALID_POINTS");
    }

    [Fact]
    public void Model_declared_invalid_range_is_rejected()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "directive simulation {initial=10;final=0}\n<a>", Operation = "simulate" });
        Assert.False(response.Success);
        Assert.Equal("INVALID_TIME_RANGE", Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public void Timing_overrides_apply_to_every_named_simulation()
    {
        const string code = "directive simulator deterministic\ndirective simulations [a={final=1000;points=10};b={final=2000;points=10}]\n<a>";
        EngineResponse response = CoreEngine.Execute(new() { Code = code, Operation = "simulate", Final = 20, Points = 4 });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal(2, response.Model!.Simulations.Length);
        Assert.All(response.Model.Simulations, run => Assert.All(run.Times, time => Assert.InRange(time, 0, 20.000001)));
    }

    [Fact]
    public void Semantic_errors_without_source_ranges_do_not_invent_editor_positions()
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "\nmissing()" });
        Assert.False(response.Success);
        Diagnostic diagnostic = Assert.Single(response.Diagnostics);
        Assert.Equal("MODEL_ERROR", diagnostic.Code);
        Assert.Contains("missing", diagnostic.Message);
        Assert.Null(diagnostic.Line);
        Assert.Null(diagnostic.Column);
    }

    [Fact]
    public void Named_runs_report_their_own_seed_instead_of_the_default_seed()
    {
        const string code = "directive simulator stochastic\ndirective simulations [a={final=1;points=2;seed=11};b={final=2;points=2;seed=22}]\n<a>";
        EngineResponse response = CoreEngine.Execute(new() { Code = code, Operation = "simulate" });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal(new int?[] { 11, 22 }, response.Model!.Simulations.Select(run => run.Seed).ToArray());
    }

    [Theory]
    [InlineData("directive simulations [a={initial=10;final=0}]")]
    [InlineData("directive simulations [a={points=0}]")]
    public void Named_simulations_cannot_bypass_simulation_validation(string directive)
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = directive + "\n<a>", Operation = "simulate", Simulator = "oslo" });
        Assert.False(response.Success);
        Assert.Contains(response.Diagnostics, diagnostic => diagnostic.Code is "INVALID_TIME_RANGE" or "INVALID_POINTS");
    }

    [Theory]
    [InlineData("directive simulations [a={final=10};b={final=20}]")]
    [InlineData("directive parameters [N=1]\ndirective sweeps [s=[N=[1;2]]]")]
    public void JIT_batch_settings_create_independent_runs(string directive)
    {
        EngineResponse response = CoreEngine.Execute(new() { Code = "directive jit\ndirective simulator stochastic\n" + directive + "\n<a>", Operation = "simulate", Seed = 42 });
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        Assert.Equal(2, response.Model!.Simulations.Length);
        Assert.All(response.Model.Simulations, run => Assert.NotNull(run.Network));
    }
}
