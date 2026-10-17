using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class CompatibilityTests
{
    private static JsonElement[] Cases(string file) => JsonDocument.Parse(File.ReadAllText(Path.Combine(LocalHost.Root, "tests", "baselines", file))).RootElement.GetProperty("cases").EnumerateArray().Select(value => value.Clone()).ToArray();
    public static IEnumerable<object[]> ParseCases => Cases("engine-baselines.json").Where(value => value.GetProperty("spec").GetProperty("operation").GetString() == "parse").Select(value => new object[] { value.GetProperty("spec").GetProperty("id").GetString()! });
    public static IEnumerable<object[]> NumericalCases => Cases("compatibility-baselines.json").Where(value => value.GetProperty("spec").GetProperty("dialect").GetString() == "current" && value.GetProperty("spec").GetProperty("operation").GetString() is "trajectory-oslo" or "trajectory-ssa").Select(value => new object[] { value.GetProperty("spec").GetProperty("id").GetString()! });
    private static string Code(JsonElement item)
    {
        string path = Path.Combine(LocalHost.Root, item.GetProperty("spec").GetProperty("source").GetString()!);
        Assert.Equal(item.GetProperty("sourceSha256").GetString(), Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant());
        return File.ReadAllText(path);
    }

    private static void Network(ModelData model)
    {
        Assert.NotNull(model.Settings); Assert.NotNull(model.Species); Assert.NotNull(model.Reactions); Assert.NotNull(model.Simulations);
        var ids = model.Species.Select(species => species.Id).ToHashSet();
        Assert.Equal(model.Species.Length, ids.Count);
        foreach (var reaction in model.Reactions)
            Assert.All(reaction.Reactants.Concat(reaction.Products).Concat(reaction.Catalysts), entry => { Assert.Contains(entry.SpeciesId, ids); Assert.True(entry.Multiplicity > 0); });
    }

    [Theory]
    [InlineData("oslo")]
    [InlineData("ssa")]
    public void Timed_inputs_keep_unique_ids_and_absolute_event_times_without_changing_the_population(string simulator)
    {
        var response = CoreEngine.Execute(new() { Code = "directive simulation {final=1;points=20;plots=[<a>]}\n(1 * <a> | 3 * <a> @ 0.5)", Operation = "simulate", Simulator = simulator, Seed = 42 });
        Assert.True(response.Success, JsonSerializer.Serialize(response)); Network(response.Model!);
        var initial = Assert.Single(response.Model!.Species.Where(species => species.SourceId == null));
        var input = Assert.Single(response.Model.Species.Where(species => species.SourceId != null));
        Assert.Equal(initial.Id, input.SourceId); Assert.Equal("3", input.Initial); Assert.Equal("0.5", input.Time); Assert.Equal("timedInput", input.ValueKind);
        var run = Assert.Single(response.Model.Simulations); Assert.Equal(1, run.Series[0].Values[0]); Assert.Equal(4, run.Series[0].Values[^1]);
    }

    [Theory]
    [MemberData(nameof(ParseCases))]
    public void Every_original_corpus_input_returns_a_consistent_public_result(string id)
    {
        var item = Cases("engine-baselines.json").Single(value => value.GetProperty("spec").GetProperty("id").GetString() == id);
        var spec = item.GetProperty("spec"); var expected = item.GetProperty("expected");
        var response = CoreEngine.Execute(new() { Code = Code(item), Dialect = spec.GetProperty("dialect").GetString()!, Operation = "parse" });
        Assert.Equal(expected.GetProperty("status").GetString() == "pass", response.Success);
        if (!response.Success) { Assert.Null(response.Model); Assert.NotEmpty(response.Diagnostics); return; }
        Assert.Empty(response.Diagnostics); Network(response.Model!);
        Assert.Equal(expected.GetProperty("kind").GetString(), response.Model!.Kind);
        Assert.Equal(expected.GetProperty("initials").GetArrayLength(), response.Model.Species.Length);
    }

    [Theory]
    [MemberData(nameof(NumericalCases))]
    public void Public_simulation_trajectories_match_independently_recorded_original_values(string id)
    {
        var item = Cases("compatibility-baselines.json").Single(value => value.GetProperty("spec").GetProperty("id").GetString() == id);
        var expected = item.GetProperty("expected"); string simulator = item.GetProperty("spec").GetProperty("operation").GetString()!.Replace("trajectory-", "");
        // The oracle preserves native output sampling, plots every species, and fixes its random seed.
        string simulation = "directive simulation {initial=0;final=100;points=10;seed=42;plots=[]}";
        string code = Code(item);
        code = Regex.IsMatch(code, @"directive simulation\s*\{") ? Regex.Replace(code, @"directive simulation\s*\{[^}]*\}", simulation) : simulation + "\n" + code;
        var response = CoreEngine.Execute(new() { Code = code, Operation = "simulate", Simulator = simulator });
        Assert.True(response.Success, JsonSerializer.Serialize(response)); Network(response.Model!);
        var run = Assert.Single(response.Model!.Simulations);
        var times = expected.GetProperty("times").EnumerateArray().Select(value => value.GetDouble()).ToArray();
        Assert.Equal(times, run.Times);
        var columns = expected.GetProperty("columns").EnumerateArray().Select(value => value.GetString()!).ToArray();
        var values = expected.GetProperty("values").EnumerateArray().Select(row => row.EnumerateArray().Select(value => value.GetDouble()).ToArray()).ToArray();
        Assert.Equal(columns.Length, run.Series.Length);
        string Normalize(string text) => text.Replace("\r", "").Replace("\n", "").Replace("\t", "");
        foreach (var series in run.Series)
        {
            var species = response.Model.Species.Single(species => species.Id == series.Name || species.Name == series.Name);
            int index = Array.IndexOf(columns, Normalize(species.Structure)); Assert.True(index >= 0, series.Name);
            for (int row = 0; row < times.Length; row++)
                Assert.InRange(Math.Abs(values[index][row] - series.Values[row]), 0, 1e-9 + 1e-6 * Math.Max(Math.Abs(values[index][row]), Math.Abs(series.Values[row])));
        }
    }
}
