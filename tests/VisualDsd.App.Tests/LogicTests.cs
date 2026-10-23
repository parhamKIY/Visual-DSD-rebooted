using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using System.Net.Http.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class LogicTests
{
    internal static ModelRequest Request(string code, string language = "dsd") => new()
    {
        Code = code, Language = language, Operation = "simulate", Simulator = "oslo", Initial = 0, Final = 2, Points = 10,
        LogicCase = new([new(language == "crn" ? "A" : "<a>", 7)], [language == "crn" ? "B" : "<b>"])
    };

    [Theory]
    [InlineData("dsd", "directive simulation {final=2}\n(2 * <a> | 3 * <a> | rxn <a> ->{1} <b>)")]
    [InlineData("crn", "directive simulation {final=2}\n2 A | 3 A | A ->{1} B")]
    public void Structural_overrides_replace_total_contributions_without_rewriting_source(string language, string code)
    {
        var request = Request(code, language);
        var result = CoreEngine.Execute(request);
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        var run = Assert.Single(result.Model!.Simulations);
        var series = Assert.Single(run.Series);
        Assert.InRange(series.Values[^1], 7 * (1 - Math.Exp(-2)) - .001, 7 * (1 - Math.Exp(-2)) + .001);
        Assert.Equal(code, request.Code);
        Assert.Equal("nM", result.Model.Settings.ConcentrationUnit);
        // A later ordinary run must retain the original total of 5, without leaked mutable state.
        var original = CoreEngine.Execute(request with { LogicCase = null });
        Assert.True(original.Success);
        Assert.DoesNotContain(original.Model!.Species, s => s.Initial == "7");
    }

    [Theory]
    [InlineData("directive simulation {final=2}\n(2 * <a> | rxn <a> ->{1} <b>)", "<missing>")]
    [InlineData("directive simulation {final=2}\n(constant 2 * <a> | rxn <a> ->{1} <b>)", "<a>")]
    [InlineData("directive simulation {final=2}\n(2 * <a> @ 1 | rxn <a> ->{1} <b>)", "<a>")]
    [InlineData("directive parameters [k=1]\ndirective sweeps [scan=[k=[1;2]]]\n(2 * <a> | rxn <a> ->{k} <b>)", "<a>")]
    [InlineData("directive simulations [first={final=1};second={final=2}]\n(2 * <a> | rxn <a> ->{1} <b>)", "<a>")]
    public void Unsafe_or_missing_input_mapping_is_rejected(string code, string structure)
    {
        var request = Request(code) with { LogicCase = new([new(structure, 7)], ["<b>"]) };
        var result = CoreEngine.Execute(request);
        Assert.False(result.Success);
        Assert.Equal("LOGIC_MAPPING", Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Stochastic_cases_and_excessive_budgets_fail_validation()
    {
        var r = Request("<a>");
        Assert.Contains(RequestValidation.Validate(r with { Simulator = "ssa" }), d => d.Code == "LOGIC_OPTIONS");
        Assert.Contains(RequestValidation.Validate(r with { Points = 501 }), d => d.Code == "LOGIC_BUDGET");
        Assert.Contains(RequestValidation.Validate(r with { TimeoutSeconds = 121 }), d => d.Code == "LOGIC_BUDGET");
        Assert.Contains(RequestValidation.Validate(r with { LogicCase = new([new("<a>", -1)], ["<b>"]) }), d => d.Code == "LOGIC_MAPPING");
        Assert.Contains(RequestValidation.Validate(r with { LogicCase = new([new("<a>", 1), new("<a>", 2)], ["<b>"]) }), d => d.Code == "LOGIC_MAPPING");
    }

    [Fact]
    public void Sixteen_physical_rails_are_recorded_without_changing_input_concentrations()
    {
        var code = "directive simulation {final=2}\n" + string.Join(" | ", Enumerable.Range(1, 8).Select(i => $"0 A{i} | A{i} ->{{1}} B{i}"));
        var request = Request(code, "crn") with
        {
            LogicCase = new(Enumerable.Range(1, 8).Select(i => new LogicInputData($"A{i}", i)).ToArray(), Enumerable.Range(1, 8).SelectMany(i => new[] { $"B{i}", $"A{i}" }).ToArray())
        };
        Assert.Empty(RequestValidation.Validate(request));
        var result = CoreEngine.Execute(request);
        Assert.True(result.Success, JsonSerializer.Serialize(result));
        var run = Assert.Single(result.Model!.Simulations);
        Assert.Equal(16, run.Series.Length);
        Assert.Equal(3, run.Series.Single(s => s.Name == "A3").Values[0]);
        Assert.InRange(run.Series.Single(s => s.Name == "B3").Values[^1], 2.59, 2.60);
        Assert.Contains(RequestValidation.Validate(request with { LogicCase = new(request.LogicCase.Inputs, [.. request.LogicCase.Outputs, "extra"]) }), d => d.Code == "LOGIC_MAPPING");
    }

    [Fact]
    public void Real_compiler_output_executes_the_eight_cases_of_a_three_level_Seesaw_circuit()
    {
        using var example = JsonDocument.Parse(File.ReadAllText(Path.Combine(LocalHost.Root, "src/VisualDsd.App/Web/logic-example.json")));
        var source = example.RootElement.GetProperty("code").GetString()!;
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(source)));
        Assert.Equal(example.RootElement.GetProperty("provenance").GetProperty("sha256").GetString(), hash);
        var config = example.RootElement.GetProperty("logic").GetProperty("config");
        var inputs = config.GetProperty("inputs").EnumerateArray().Select(i => i.GetProperty("one").GetString()!).ToArray();
        string output = config.GetProperty("outputs")[0].GetProperty("one").GetString()!;
        for (int bits = 0; bits < 8; bits++)
        {
            var expected = ((bits & 4) != 0 || (bits & 2) != 0) && (bits & 1) != 0;
            var request = Request(source) with { Dialect = "auto", Final = 36000, Points = 200, LogicCase = new(inputs.Select((s, i) => new LogicInputData(s, (bits & (4 >> i)) != 0 ? 90 : 10)).ToArray(), [output]) };
            var result = CoreEngine.Execute(request);
            Assert.True(result.Success, JsonSerializer.Serialize(result));
            Assert.Equal("legacy", result.Dialect);
            var run = Assert.Single(result.Model!.Simulations);
            var series = Assert.Single(run.Series);
            Assert.InRange(series.Values[^1], expected ? 80 : 0, expected ? 151 : 20);
            Assert.Equal(36000, run.Times[^1]);
            Assert.Equal(output, result.Model.Species.Single(s => s.Id == series.Name).Structure);
        }
    }
}

[Collection("Process integration")]
public class LogicWorkerTests(LocalHost host) : IClassFixture<LocalHost>
{
    [Fact]
    public async Task Logic_overrides_survive_job_storage_and_the_isolated_worker()
    {
        var request = LogicTests.Request("directive simulation {final=2}\n(2 * <a> | rxn <a> ->{1} <b>)");
        var response = await host.Client.PostAsJsonAsync("/api/jobs", request);
        response.EnsureSuccessStatusCode();
        var admitted = (await response.Content.ReadFromJsonAsync<JobView>())!;
        var retained = (await host.Client.GetFromJsonAsync<ModelRequest>($"/api/jobs/{admitted.Id}/input"))!;
        Assert.Equal("<a>", retained.LogicCase!.Inputs[0].Structure);
        Assert.Equal(7, retained.LogicCase.Inputs[0].Value);
        var done = await host.FinishAsync(admitted.Id);
        Assert.Equal("succeeded", done.State);
        Assert.InRange(done.Result!.Model!.Simulations[0].Series[0].Values[^1], 6, 6.1);
    }
}
