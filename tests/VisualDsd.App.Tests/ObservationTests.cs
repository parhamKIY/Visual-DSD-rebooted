using VisualDsd.Contracts;
using Xunit;

namespace VisualDsd.Tests;

public class ObservationTests
{
    [Fact]
    public void Csv_preserves_BOM_quotes_full_precision_and_time_units()
    {
        var result = ObservationCsv.Parse("experiment", "\uFEFFTime (s),\"<a>,\"\"b\"\"\"\r\n0,1e-12\r\n0.123456789012345,2.34567890123456\r\n");
        var table = Assert.Single(result.Tables); var column = Assert.Single(table.Series);
        Assert.Equal("s", table.TimeUnit); Assert.Equal("<a>,\"b\"", column.Name);
        Assert.Equal(.123456789012345, table.Times[1]); Assert.Equal(2.34567890123456, column.Values[1]);
    }

    [Theory]
    [InlineData("Other,a\n0,1\n1,2")]
    [InlineData("Time,a\n0,1\n0,2")]
    [InlineData("Time,a\n0,1\n1,NaN")]
    [InlineData("Time,a\n0,1\n1,")]
    [InlineData("Time,a,a\n0,1,2\n1,2,3")]
    [InlineData("Time,a\n0,1,2\n1,2")]
    [InlineData("Time,\"a\n0,1\n1,2")]
    [InlineData("Time,\"a\"x\n0,1\n1,2")]
    public void Malformed_or_ambiguous_observations_are_rejected(string csv) => Assert.Throws<FormatException>(() => ObservationCsv.Parse("experiment", csv));

    [Fact]
    public void Null_datasets_and_nonfinite_or_mismatched_arrays_are_rejected_before_worker_admission()
    {
        foreach (var data in new DatasetData[][] { null!, [null!], [new("x", [new([0, 1], [new("a", [1])])])],
            [new("x", [new([0, double.PositiveInfinity], [new("a", [1, 2])])])] })
            Assert.Contains(RequestValidation.Validate(new() { Code = "<a>", Data = data }), d => d.Code == "INVALID_DATA");
    }
}
