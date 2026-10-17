using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class DistributionTests
{
    const string Decay = "directive simulation {final=1;points=100;plots=[A;B]}\ndirective deterministic {reltolerance=1e-9;abstolerance=1e-12}\n| 3 A | A ->{0.5} B";
    static ModelData Success(string code, string solver, string language = "crn", string operation = "simulate")
    {
        var result = CoreEngine.Execute(new() { Code = code, Simulator = solver, Language = language, Operation = operation });
        Assert.True(result.Success, JsonSerializer.Serialize(result)); return result.Model!;
    }

    [Theory]
    [InlineData("cme", false)]
    [InlineData("cme", true)]
    [InlineData("cmesundials", false)]
    [InlineData("cmesundials", true)]
    public void Joint_probabilities_match_binomial_decay_and_exact_exported_moments(string solver, bool explicitTimes)
    {
        var run = Assert.Single(Success(explicitTimes ? Decay.Replace("points=100", "points=400;times=[0.25;0.5;1]") : Decay, solver).Simulations);
        var data = Assert.IsType<ProbabilityData>(run.Probabilities);
        Assert.Equal(4, data.States.Length); Assert.Equal(run.Times.Length, data.Mass.Length);
        Assert.Equal(new[] { "A", "B" }, data.SpeciesIds);
        Assert.All(data.States, state => Assert.Equal(3, state.Sum()));
        if (explicitTimes) Assert.Equal(new[] { .25, .5, 1 }, run.Times);
        double[] choose = [1, 3, 3, 1];
        for (int t = 0; t < run.Times.Length; t++)
        {
            var mass = data.Mass[t]; Assert.InRange(Math.Abs(mass.Sum() - 1), 0, 1e-12);
            double p = Math.Exp(-.5 * run.Times[t]);
            for (int i = 0; i < mass.Length; i++)
            {
                int n = data.States[i][0];
                Assert.InRange(Math.Abs(mass[i] - choose[n] * Math.Pow(p, n) * Math.Pow(1 - p, 3 - n)), 0, .0002);
            }
            for (int species = 0; species < 2; species++)
            {
                double mean = mass.Select((probability, i) => probability * data.States[i][species]).Sum();
                double variance = mass.Select((probability, i) => probability * Math.Pow(data.States[i][species] - mean, 2)).Sum();
                Assert.Equal(mean, run.Series[species].Values[t], 10);
                Assert.Equal(Math.Sqrt(variance), run.Series[species].StandardDeviation![t], 10);
            }
        }
    }

    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Probability_runs_keep_independent_state_spaces_and_sweep_assignments(string solver)
    {
        var model = Success("directive parameters [N=2]\ndirective sweeps [doses=[N=[2;5]]]\ndirective simulations [a={initial=5;final=6;points=10};b={initial=7;final=9;points=20}]\n" + Decay.Replace("3 A", "N A"), solver);
        Assert.Equal(4, model.Simulations.Length);
        for (int i = 0; i < 4; i++)
        {
            var run = model.Simulations[i]; var data = run.Probabilities!; int n = i % 2 == 0 ? 2 : 5;
            Assert.Equal(n + 1, data.States.Length); Assert.Equal(run.Times.Length, data.Mass.Length);
            Assert.Equal(i < 2 ? 5 : 7, run.Times[0]); Assert.Equal(i < 2 ? 6 : 9, run.Times[^1]);
            Assert.All(data.States, state => Assert.Equal(n, state.Sum()));
        }
    }

    [Theory]
    [InlineData("cme")]
    [InlineData("cmesundials")]
    public void Absorbing_networks_preserve_probability_one(string solver)
    {
        var run = Assert.Single(Success("directive simulation {final=1;points=5}\n| 5 A", solver).Simulations);
        Assert.Equal(new[] { 5 }, Assert.Single(run.Probabilities!.States));
        Assert.All(run.Probabilities.Mass, row => Assert.Equal(1, Assert.Single(row)));
    }

    [Fact]
    public void Rare_probability_tails_are_retained()
    {
        var run = Assert.Single(Success(Decay.Replace("final=1;points=100", "final=0.001;points=5"), "cmesundials").Simulations);
        int index = Array.FindIndex(run.Probabilities!.States, row => row[0] == 0);
        Assert.InRange(run.Probabilities.Mass[^1][index], 1e-12, 1e-8);
    }

    [Fact]
    public void Large_probability_outputs_are_rejected_before_integration()
    {
        var result = CoreEngine.Execute(new() { Code = Decay.Replace("points=100", "points=100000"), Language = "crn", Simulator = "cme", Operation = "simulate" });
        Assert.False(result.Success); Assert.Equal("PROBABILITY_LIMIT", Assert.Single(result.Diagnostics).Code);
    }

    [Theory]
    [InlineData("oslo")]
    [InlineData("lna")]
    [InlineData("mc")]
    public void Other_solvers_do_not_fabricate_a_probability_distribution(string solver)
    {
        Assert.Null(Assert.Single(Success(Decay, solver).Simulations).Probabilities);
    }

    [Fact]
    public void JIT_generated_binding_states_match_full_expansion_without_simulation()
    {
        const string code = "dom a = {bind=0.1;unbind=0.2}\n(2 * <a^ b> | 2 * {a^*}[b])";
        var full = Assert.Single(Success(code, "source", "dsd", "analyze").Simulations);
        var lazy = Assert.Single(Success("directive jit\n" + code, "source", "dsd", "analyze").Simulations);
        Assert.Equal(3, lazy.StateSpace!.States.Length);
        Assert.Equal(2, lazy.StateSpace.Transitions.Length);
        Assert.Empty(lazy.Times); Assert.Empty(lazy.Series); Assert.All(lazy.Network!.Species, sp => Assert.Equal("initial", sp.ValueKind));
        string[] Canonical(SimulationData run) => run.StateSpace!.States.Select(row => string.Join("|", row.Select((n, i) => (name: run.Network?.Species.First(sp => sp.Id == run.StateSpace.SpeciesIds[i]).Structure ?? code, n))
            .OrderBy(pair => pair.name).Select(pair => $"{pair.name}:{pair.n}"))).Order().ToArray();
        // The expanded run uses the model network; attach it for structural comparison.
        var fullModel = Success(code, "source", "dsd", "analyze");
        full = full with { Network = new(fullModel.Species, fullModel.Reactions) };
        Assert.Equal(Canonical(full), Canonical(lazy));
        Assert.Equal(full.StateSpace!.Transitions.Select(t => t.Rate).Order(), lazy.StateSpace!.Transitions.Select(t => t.Rate).Order());
    }

    [Fact]
    public void JIT_analysis_keeps_explicit_reactions_and_parameter_sweeps()
    {
        var model = Success("directive jit\ndirective parameters [k=0.5]\ndirective sweeps [rates=[k=[0;2]]]\n(3 * <a> | rxn <a> ->{k} <b>)", "source", "dsd", "analyze");
        Assert.True(model.IsJit); Assert.Equal(2, model.Simulations.Length);
        Assert.Single(model.Simulations[0].StateSpace!.States);
        Assert.Equal(4, model.Simulations[1].StateSpace!.States.Length);
        Assert.Equal(new double[] { 2, 4, 6 }, model.Simulations[1].StateSpace!.Transitions.Select(t => t.Rate).Order());
        Assert.All(model.Simulations, run => Assert.NotEmpty(run.Network!.Reactions));
    }

    [Fact]
    public void Rules_JIT_analysis_discovers_reachable_processes()
    {
        const string source = "directive jit\ndirective parameters [pol=0.3]\n" +
            "directive rules { reaction([P],\"pol\",Q) :- P = C [b>], Q = C [c>]. }\n( 2 * [<tb^ b>] )";
        var model = Success(source, "source", "dsd", "analyze");
        Assert.Equal("rules", model.Kind);
        var run = Assert.Single(model.Simulations);
        Assert.Equal(3, run.StateSpace!.States.Length);
        Assert.Equal(new double[] { .3, .6 }, run.StateSpace.Transitions.Select(t => t.Rate).Order());
    }

    [Theory]
    [InlineData("(1 * <a> | rxn <a> ->{1} <a> + <a>)", "STATE_SPACE_LIMIT")]
    [InlineData("1.5 * <a>", "JIT_STATE_SPACE")]
    [InlineData("(1 * <a> | rxn <a> ->[(-1 * [<a>])] <a>)", "STATE_SPACE_RATE")]
    [InlineData("(1 * <a> | 1 * <a> @ 0.5)", "JIT_STATE_SPACE")]
    public void JIT_analysis_never_returns_a_partial_or_invalid_state_space(string code, string diagnostic)
    {
        var response = CoreEngine.Execute(new() { Code = "directive jit\n" + code, Operation = "analyze" });
        Assert.False(response.Success); Assert.Null(response.Model); Assert.Equal(diagnostic, Assert.Single(response.Diagnostics).Code);
    }
}
