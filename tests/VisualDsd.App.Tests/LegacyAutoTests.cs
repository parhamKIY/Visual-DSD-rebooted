using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class LegacyAutoTests
{
    public static IEnumerable<object[]> OriginalFiles
    {
        get
        {
            using var cases = JsonDocument.Parse(File.ReadAllText(Path.Combine(LocalHost.Root, "tests", "baselines", "cases.json")));
            return cases.RootElement.EnumerateArray()
                .Where(item => item.GetProperty("dialect").GetString() == "legacy" && item.GetProperty("expectedStatus").GetString() == "pass")
                .Select(item => item.GetProperty("source").GetString()!).Distinct(StringComparer.Ordinal)
                .Select(path => new object[] { path }).ToArray();
        }
    }

    [Theory]
    [MemberData(nameof(OriginalFiles))]
    public void Original_supported_legacy_files_can_be_pasted_without_the_marker(string path)
    {
        string code = File.ReadAllText(Path.Combine(LocalHost.Root, path)).Replace("//old_syntax", "// original example", StringComparison.Ordinal);
        var request = new ModelRequest { Code = code };
        var automatic = CoreEngine.Execute(request);
        var expected = CoreEngine.Execute(request with { Dialect = "legacy" });
        Assert.True(expected.Success, JsonSerializer.Serialize(expected));
        Assert.True(automatic.Success, JsonSerializer.Serialize(automatic));
        Assert.Equal(JsonSerializer.Serialize(expected.Model), JsonSerializer.Serialize(automatic.Model));
    }
}
