using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class CrnTests
{
    public const string Decay = "directive simulator deterministic\ndirective deterministic {reltolerance=1e-9;abstolerance=1e-11}\ndirective simulation {final=1;points=10;plots=[A;B]}\ndirective parameters [k=0.5]\n| 10 A | A ->{k} B";
    public const string Systems = "directive simulator deterministic\ndirective deterministic {reltolerance=1e-9;abstolerance=1e-11}\ndirective simulation {final=1;points=10;plots=[A]}\ndirective parameters [k=0.5]\nsystem slow = { | 10 A | A ->{k} B }\nsystem fast = { directive parameters [k=1] | 20 A | A ->{k} B }";
    public const string Graph = Systems + "\nnode first {systems=[slow]}\nnode second {systems=[fast]}\nedge first -> [k=Normal] second";

    private static ModelData Success(ModelRequest request)
    {
        var response = CoreEngine.Execute(request);
        Assert.True(response.Success, JsonSerializer.Serialize(response));
        return response.Model!;
    }

    [Fact]
    public void Standalone_crn_uses_original_names_and_has_an_analytic_decay_trajectory()
    {
        var model = Success(new() { Code = Decay, Language = "crn", Operation = "simulate" });
        Assert.Equal("crn", model.Kind); Assert.Equal("source", model.Compilation);
        Assert.Equal(new[] { "A", "B" }, model.Species.Select(s => s.Id).Order());
        var run = Assert.Single(model.Simulations);
        Assert.InRange(Math.Abs(run.Series.Single(s => s.Name == "A").Values[^1] - 10 * Math.Exp(-0.5)), 0, 1e-4);
        Assert.Equal(Decay, model.Program!.Source);
        Assert.NotNull(model.CrnCode);
    }

    [Theory]
    [InlineData("slow", 10, 0.5)]
    [InlineData("fast", 20, 1)]
    public void Systems_keep_their_own_networks_and_local_parameters_override_shared_defaults(string system, double initial, double rate)
    {
        var model = Success(new() { Code = Systems, Language = "crn", SystemId = system, Operation = "simulate" });
        Assert.Equal(system, model.Program!.SelectedSystemId);
        Assert.Equal(3, Assert.Single(model.Program.Nodes).Systems.Length);
        var run = Assert.Single(model.Simulations); var series = Assert.Single(run.Series);
        Assert.Equal(initial, series.Values[0]);
        Assert.InRange(Math.Abs(series.Values[^1] - initial * Math.Exp(-rate)), 0, 1e-4);
    }

    [Fact]
    public void Graph_keeps_nodes_systems_edges_and_original_source_while_executing_only_the_selected_system()
    {
        var model = Success(new() { Code = Graph, Language = "crn", NodeId = "second", SystemId = "fast", Operation = "simulate" });
        Assert.Equal(2, model.Program!.Nodes.Length); Assert.Equal(Graph, model.Program.Source);
        var edge = Assert.Single(model.Program.Edges);
        Assert.Equal("first", edge.Source.NodeId); Assert.Equal("second", edge.Target.NodeId);
        Assert.Equal("Normal", Assert.Single(edge.Parameters).Kind);
        Assert.Equal(20, Assert.Single(Assert.Single(model.Simulations).Series).Values[0]);
        var again = Success(new() { Code = model.Program.Source, Language = "crn", NodeId = "first", SystemId = "slow", Operation = "simulate" });
        Assert.Equal(10, Assert.Single(Assert.Single(again.Simulations).Series).Values[0]);
    }

    [Fact]
    public void Dsd_expansion_can_be_edited_as_an_independent_crn_without_changing_the_source_model()
    {
        const string dsd = "directive simulator deterministic\ndirective deterministic {reltolerance=1e-9;abstolerance=1e-11}\ndirective simulation {final=1;points=10}\n(10 * <a> | rxn <a> ->{0.5} <b>)";
        var original = Success(new() { Code = dsd, Operation = "simulate" });
        var crn = Success(new() { Code = original.CrnCode!, Language = "crn", Operation = "simulate" });
        Assert.Equal(original.Reactions.Length, crn.Reactions.Length);
        Assert.Equal(original.Simulations[0].Times, crn.Simulations[0].Times);
        for (int i = 0; i < crn.Simulations[0].Series.Length; i++) Assert.Equal(original.Simulations[0].Series[i].Values, crn.Simulations[0].Series[i].Values);
    }

    [Fact]
    public void Shared_functional_rates_and_local_parameters_follow_original_model_preparation()
    {
        string code = Systems.Replace("system slow", "directive rates [loss=k*[A]]\nsystem slow").Replace("A ->{k} B", "A ->[[loss]] B");
        var model = Success(new() { Code = code, Language = "crn", SystemId = "slow", Operation = "simulate" });
        Assert.InRange(Math.Abs(Assert.Single(Assert.Single(model.Simulations).Series).Values[^1] - 10 * Math.Exp(-0.5)), 0, 1e-4);
        var local = Success(new() { Code = Systems, Language = "crn", SystemId = "fast", Operation = "simulate" });
        var standalone = Success(new() { Code = local.CrnCode!, Language = "crn", SystemId = "fast", Operation = "simulate" });
        Assert.Equal(local.Simulations[0].Series[0].Values, standalone.Simulations[0].Series[0].Values);
    }

    [Fact]
    public void Modules_inherited_systems_and_shared_sweeps_keep_their_original_scope()
    {
        const string code = "directive simulator deterministic\ndirective simulation {final=1;points=5;plots=[A;B];sweeps=[doses]}\ndirective parameters [k=0.5;N=10]\ndirective sweeps [doses=[N=[2;5]]]\nmodule Move(X,Y,r) = { X ->{r} Y }\nsystem parent = { | N A | Move(A,B,k) }\nsystem child = { parent with | 3 B }";
        var model = Success(new() { Code = code, Language = "crn", SystemId = "child", Operation = "simulate" });
        Assert.Equal(2, model.Simulations.Length);
        Assert.Equal(new double[] { 2, 5 }, model.Simulations.Select(run => run.Series.Single(s => s.Name == "A").Values[0]));
        Assert.All(model.Simulations, run => Assert.Equal(3, run.Series.Single(s => s.Name == "B").Values[0]));
    }

    [Fact]
    public void System_links_retain_both_endpoints_and_the_prior_kind()
    {
        string code = Systems + "\nnode first {systems=[slow]}\nnode second {systems=[fast]}\nedge first.slow -> [k=LogNormal] second.fast";
        var model = Success(new() { Code = code, Language = "crn" });
        var edge = Assert.Single(model.Program!.Edges);
        Assert.Equal("slow", edge.Source.SystemId); Assert.Equal("fast", edge.Target.SystemId);
        Assert.Equal("LogNormal", Assert.Single(edge.Parameters).Kind);
    }

    [Fact]
    public void Crn_state_exploration_uses_the_selected_population_and_transition_rates()
    {
        var model = Success(new() { Code = Decay, Language = "crn", Operation = "analyze" });
        var states = Assert.Single(model.Simulations).StateSpace!;
        Assert.Equal(11, states.States.Length); Assert.Equal(10, states.Transitions.Length);
        Assert.Equal(5, states.Transitions.Single(edge => edge.Source == states.InitialState).Rate);
    }

    [Fact]
    public void Standalone_crn_fitting_uses_the_existing_seeded_inference_path()
    {
        string code = ScientificTests.FitCode.Replace("<a>", "A").Replace("(10 * A | rxn A ->{k} <b>)", "| 10 A | A ->{k} B");
        var data = ScientificTests.Data.Select(dataset => new DatasetData(dataset.Name, dataset.Tables.Select(table =>
            new ObservationData(table.Times, table.Series.Select(series => new SeriesData("A", series.Values)).ToArray())).ToArray())).ToArray();
        var model = Success(new() { Code = code, Language = "crn", Operation = "infer", Data = data });
        Assert.InRange(model.Inference!.Parameters.Single(p => p.Name == "k").Mle, .33, .37);
        Assert.Equal("crn", model.Kind); Assert.Equal(code, model.Program!.Source);
    }

    [Fact]
    public void Crn_input_cannot_silently_accept_dsd_only_options()
    {
        foreach (var request in new ModelRequest[] {
            new() { Code = Decay, Language = "crn", Dialect = "legacy" },
            new() { Code = Decay, Language = "crn", Compilation = "finite" },
            new() { Code = Decay, Language = "crn", Toeholds = "database" } })
            Assert.Contains(RequestValidation.Validate(request), diagnostic => diagnostic.Code == "CRN_OPTIONS");
    }

    [Theory]
    [InlineData("Catalytic.txt")]
    [InlineData("Manual/Join.txt")]
    [InlineData("Simple - AND Circuit.txt")]
    public void Expanded_original_examples_reparse_and_simulate_as_independent_crns(string file)
    {
        var path = Path.Combine(LocalHost.Root, "upstream", "crn-engine", "ClassicDSD", "Examples", "DSDModels", file);
        var original = Success(new() { Code = File.ReadAllText(path), Operation = "simulate", Simulator = "oslo", Final = 1, Points = 5 });
        var crn = Success(new() { Code = original.CrnCode!, Language = "crn", Operation = "simulate" });
        Assert.Equal(original.Simulations[0].Times, crn.Simulations[0].Times);
        Assert.Equal(original.Reactions.Length, crn.Reactions.Length);
        foreach (var series in original.Simulations[0].Series)
            Assert.Equal(series.Values, crn.Simulations[0].Series.Single(s => s.Name == series.Name).Values);
    }

    [Theory]
    [InlineData("oslo")]
    [InlineData("ssa")]
    [InlineData("lna")]
    [InlineData("cme")]
    public void Selected_crns_use_the_existing_scientific_solvers(string simulator)
    {
        var model = Success(new() { Code = Decay, Language = "crn", Operation = "simulate", Simulator = simulator, Seed = 42 });
        Assert.NotEmpty(Assert.Single(model.Simulations).Times);
    }

    [Theory]
    [InlineData("missing", null)]
    [InlineData(null, "missing")]
    public void Unknown_selections_cannot_silently_run_a_different_model(string? node, string? system)
    {
        var response = CoreEngine.Execute(new() { Code = Systems, Language = "crn", NodeId = node, SystemId = system, Operation = "simulate" });
        Assert.False(response.Success); Assert.Equal("CRN_SELECTION", Assert.Single(response.Diagnostics).Code);
    }

    [Theory]
    [InlineData("node first {systems=[slow]}\nnode first {systems=[fast]}", "CRN_DUPLICATE")]
    [InlineData("node first {systems=[slow]}\nedge first -> [k] missing", "CRN_REFERENCE")]
    [InlineData("node first {systems=[slow]}\nnode second {systems=[fast]}\nedge first -> [unknown] second", "CRN_REFERENCE")]
    [InlineData("node first {systems=[slow]}\nnode second {systems=[fast]}\nedge first -> [k] second\nedge second -> [k] first", "CRN_GRAPH_CYCLE")]
    public void Broken_graphs_are_rejected_before_execution(string suffix, string diagnostic)
    {
        var response = CoreEngine.Execute(new() { Code = Systems + "\n" + suffix, Language = "crn" });
        Assert.False(response.Success); Assert.Equal(diagnostic, Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public void Graph_inference_is_never_presented_as_an_independent_fit_of_one_selected_system()
    {
        var response = CoreEngine.Execute(new() { Code = Graph, Language = "crn", Operation = "infer", Data = [new("data", [new([0,1], [new("A", [10,5])])])] });
        Assert.False(response.Success); Assert.Equal("INFERENCE_DATA", Assert.Single(response.Diagnostics).Code);
    }
}
