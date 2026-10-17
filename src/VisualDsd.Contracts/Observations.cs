using System.Globalization;
using System.Text;

namespace VisualDsd.Contracts;

public static class ObservationValidation
{
    public static Diagnostic[] Validate(DatasetData[]? data)
    {
        Diagnostic[] Invalid(string message) => [new("INVALID_DATA", message)];
        if (data is null || data.Length > 8) return Invalid("Provide at most eight datasets.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        long values = 0;
        foreach (var dataset in data)
        {
            if (dataset is null || string.IsNullOrWhiteSpace(dataset.Name) || dataset.Name.Length > 120 || !names.Add(dataset.Name) || dataset.Tables is not { Length: > 0 and <= 32 })
                return Invalid("Dataset names must be unique and each dataset must contain 1–32 tables.");
            foreach (var table in dataset.Tables)
            {
                if (table?.Times is not { Length: >= 2 and <= 20000 } || table.Series is not { Length: > 0 and <= 64 }) return Invalid("Each table needs 2–20000 times and 1–64 observation columns.");
                if (table.TimeUnit is { } unit && (string.IsNullOrWhiteSpace(unit) || unit.Length > 50)) return Invalid("Invalid observation time unit.");
                if (table.Times.Any(t => !double.IsFinite(t)) || table.Times.Zip(table.Times.Skip(1)).Any(pair => pair.Second <= pair.First)) return Invalid("Observation times must be finite and strictly increasing.");
                var columns = new HashSet<string>(StringComparer.Ordinal);
                foreach (var column in table.Series)
                {
                    if (column is null || string.IsNullOrWhiteSpace(column.Name) || column.Name.Length > 512 || !columns.Add(column.Name) || column.StandardDeviation is not null || column.Values is null || column.Values.Length != table.Times.Length || column.Values.Any(v => !double.IsFinite(v)))
                        return Invalid("Observation column names must be unique, with one finite value per time.");
                    values += column.Values.Length;
                    if (values > 20000) return Invalid("Observation data exceeds 20000 numeric measurements.");
                }
            }
        }
        return [];
    }
}

public static class ObservationCsv
{
    public static DatasetData Parse(string name, string csv)
    {
        if (csv is null || Encoding.UTF8.GetByteCount(csv) > 512 * 1024) throw new FormatException("Observation CSV exceeds 512 KiB.");
        var rows = new List<string[]>(); var row = new List<string>(); var field = new StringBuilder();
        bool quoted = false, closed = false;
        csv = csv.TrimStart('\uFEFF');
        for (int i = 0; i < csv.Length; i++)
        {
            char c = csv[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') { quoted = false; closed = true; }
                else field.Append(c);
            }
            else if (c == '"' && field.Length == 0 && !closed) quoted = true;
            else if (c is ',' or '\r' or '\n')
            {
                row.Add(field.ToString()); field.Clear(); closed = false;
                if (c != ',') { rows.Add(row.ToArray()); row.Clear(); if (c == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++; }
            }
            else if (closed || c == '"') throw new FormatException("Malformed quoted CSV field.");
            else field.Append(c);
        }
        if (quoted) throw new FormatException("Unterminated quoted CSV field.");
        if (field.Length > 0 || row.Count > 0 || closed) { row.Add(field.ToString()); rows.Add(row.ToArray()); }
        if (rows.Count < 3 || rows[0].Length < 2) throw new FormatException("CSV needs a time column, observation columns, and at least two data rows.");
        var headers = rows[0].Select(h => h.Trim()).ToArray();
        string? timeUnit = null;
        if (headers[0] != "Time")
        {
            if (!headers[0].StartsWith("Time (", StringComparison.Ordinal) || !headers[0].EndsWith(')')) throw new FormatException("The first CSV column must be Time or Time (unit).");
            timeUnit = headers[0][6..^1];
        }
        var times = new double[rows.Count - 1];
        var columns = headers.Skip(1).Select(h => new SeriesData(h, new double[rows.Count - 1])).ToArray();
        for (int r = 1; r < rows.Count; r++)
        {
            if (rows[r].Length != headers.Length) throw new FormatException($"CSV row {r + 1} has an unexpected column count.");
            for (int c = 0; c < headers.Length; c++)
            {
                if (!double.TryParse(rows[r][c], NumberStyles.Float, CultureInfo.InvariantCulture, out double value) || !double.IsFinite(value)) throw new FormatException($"CSV row {r + 1} contains a missing or invalid number.");
                if (c == 0) times[r - 1] = value; else columns[c - 1].Values[r - 1] = value;
            }
        }
        var dataset = new DatasetData(name, [new(times, columns, timeUnit)]);
        var errors = ObservationValidation.Validate([dataset]);
        if (errors.Length > 0) throw new FormatException(errors[0].Message);
        return dataset;
    }
}
