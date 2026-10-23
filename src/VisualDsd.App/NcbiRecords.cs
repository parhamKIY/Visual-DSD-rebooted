using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace VisualDsd.App;

public sealed record NcbiSearchRequest(string Database, string Term, int Start = 0);
public sealed record NcbiFetchRequest(string Database, string Id);
public sealed class NcbiFailure(int status, string message, int retryAfter = 0) : Exception(message)
{
    public int Status { get; } = status;
    public int RetryAfter { get; } = retryAfter;
}

// Fixed destination; read-only Entrez metadata/record access, never a sequence upload.
// Shared limiter covers every outbound request, including ESummary after ESearch.
public sealed class NcbiRecords(HttpClient http, TimeProvider? clock = null)
{
    private const string Root = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private DateTimeOffset nextRequest;
    private static void Database(string database)
    {
        if (database is not ("nuccore" or "protein")) throw new NcbiFailure(400, "Choose nuccore or protein.");
    }
    private static string Url(string utility, params (string Key, string Value)[] values) => Root + utility + ".fcgi?tool=VisualDsdRebooted&" + string.Join('&', values.Select(v => Uri.EscapeDataString(v.Key) + "=" + Uri.EscapeDataString(v.Value)));
    private async Task<string> ReadAsync(string url, int limit, CancellationToken token)
    {
        if (!await gate.WaitAsync(0, token)) throw new NcbiFailure(429, "Another NCBI request is active. Wait before trying again.", 1);
        try
        {
            TimeSpan delay = nextRequest - time.GetUtcNow();
            if (delay > TimeSpan.FromSeconds(1)) throw new NcbiFailure(429, "NCBI cooldown is still active. Try again after the indicated delay.", (int)Math.Ceiling(delay.TotalSeconds));
            if (delay > TimeSpan.Zero) await Task.Delay(delay, time, token);
            nextRequest = time.GetUtcNow().AddMilliseconds(500);
            using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                int retry = (int)Math.Clamp(response.Headers.RetryAfter?.Delta?.TotalSeconds ?? (response.Headers.RetryAfter?.Date - time.GetUtcNow())?.TotalSeconds ?? 30, 1, 300);
                nextRequest = time.GetUtcNow().AddSeconds(retry);
                throw new NcbiFailure(429, "NCBI rate limit reached. No automatic retry was made.", retry);
            }
            if (!response.IsSuccessStatusCode) throw new NcbiFailure(502, $"NCBI returned HTTP {(int)response.StatusCode}. Try later or import a saved record.");
            if (response.Content.Headers.ContentLength > limit) throw new NcbiFailure(413, "NCBI record exceeds the supported download size. Use a shorter record or import a region.");
            using var input = await response.Content.ReadAsStreamAsync(token);
            using var output = new MemoryStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = await input.ReadAsync(buffer, token)) > 0)
            {
                if (output.Length + count > limit) throw new NcbiFailure(413, "NCBI response exceeds the supported download size.");
                output.Write(buffer, 0, count);
            }
            return new UTF8Encoding(false, true).GetString(output.ToArray());
        }
        finally { gate.Release(); }
    }
    public async Task<object> SearchAsync(NcbiSearchRequest request, CancellationToken token)
    {
        Database(request.Database);
        if (string.IsNullOrWhiteSpace(request.Term) || request.Term.Length > 300 || request.Term.Any(char.IsControl) || request.Start is < 0 or > 1000) throw new NcbiFailure(400, "Use an Entrez text query of 1–300 characters and an offset between 0 and 1000.");
        string json = await ReadAsync(Url("esearch", ("db", request.Database), ("term", request.Term), ("retmode", "json"), ("retmax", "10"), ("retstart", request.Start.ToString(System.Globalization.CultureInfo.InvariantCulture))), 512 * 1024, token);
        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("esearchresult", out var result) || result.TryGetProperty("ERROR", out _) || result.TryGetProperty("errorlist", out _)) throw new NcbiFailure(502, "NCBI could not resolve this Entrez query. Check its field names and spelling.");
        long total = long.Parse(result.GetProperty("count").GetString()!, System.Globalization.CultureInfo.InvariantCulture);
        string[] ids = result.GetProperty("idlist").EnumerateArray().Select(v => v.GetString()!).ToArray();
        if (ids.Length > 10 || ids.Any(id => !Regex.IsMatch(id, @"^\d{1,30}$"))) throw new NcbiFailure(502, "Unexpected NCBI search identifiers.");
        var records = new List<object>();
        if (ids.Length > 0)
        {
            using var summaries = JsonDocument.Parse(await ReadAsync(Url("esummary", ("db", request.Database), ("id", string.Join(',', ids)), ("retmode", "json")), 512 * 1024, token));
            var items = summaries.RootElement.GetProperty("result");
            foreach (string id in ids)
            {
                var item = items.GetProperty(id);
                string accession = item.GetProperty("accessionversion").GetString()!, title = item.GetProperty("title").GetString()!;
                if (!Regex.IsMatch(accession, @"^[A-Za-z0-9_]+\.\d+$") || title.Length > 4000) throw new NcbiFailure(502, "Unexpected NCBI record metadata.");
                records.Add(new { uid = id, accessionVersion = accession, title, length = item.GetProperty("slen").GetInt64() });
            }
        }
        return new { database = request.Database, term = request.Term, start = request.Start, count = total, retrievedAt = time.GetUtcNow(), records };
    }
    public async Task<object> FetchAsync(NcbiFetchRequest request, CancellationToken token)
    {
        Database(request.Database);
        if (request.Id is null || !Regex.IsMatch(request.Id, @"^[A-Za-z0-9_]{1,60}(\.\d{1,10})?$")) throw new NcbiFailure(400, "Enter one accession/version or numeric record ID.");
        string url = Url("efetch", ("db", request.Database), ("id", request.Id), ("rettype", request.Database == "protein" ? "gp" : "gbwithparts"), ("retmode", "text"));
        string text = await ReadAsync(url, 5 * 1024 * 1024, token);
        var version = Regex.Match(text, @"(?m)^VERSION\s+([A-Za-z0-9_]+\.\d+)\b");
        if (!text.StartsWith("LOCUS ", StringComparison.Ordinal) || !version.Success || Regex.Matches(text, @"(?m)^LOCUS\s").Count != 1) throw new NcbiFailure(404, "NCBI returned no single annotated record. Check the database and accession.");
        if (request.Id.Contains('.') && !request.Id.Equals(version.Groups[1].Value, StringComparison.OrdinalIgnoreCase)) throw new NcbiFailure(502, "NCBI returned a different accession version; the record was not imported.");
        return new { text, retrieval = new { service = "NCBI E-utilities", database = request.Database, requested = request.Id, accessionVersion = version.Groups[1].Value, retrievedAt = time.GetUtcNow(), url, sha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant() } };
    }
    public static void Map(WebApplication app)
    {
        var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate }) { Timeout = TimeSpan.FromSeconds(20) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("VisualDsdRebooted/0.26.0");
        app.Lifetime.ApplicationStopped.Register(client.Dispose);
        var service = new NcbiRecords(client);
        async Task<IResult> Execute(HttpContext context, Func<CancellationToken, Task<object>> action)
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            deadline.CancelAfter(TimeSpan.FromSeconds(25));
            try { return Results.Json(await action(deadline.Token)); }
            catch (NcbiFailure error) { if (error.RetryAfter > 0) context.Response.Headers.RetryAfter = error.RetryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture); return Results.Json(new { error = error.Message }, statusCode: error.Status); }
            catch (OperationCanceledException) { return Results.Json(new { error = "NCBI request timed out or was cancelled. No automatic retry was made." }, statusCode: 504); }
            catch (Exception error) when (error is HttpRequestException or JsonException or KeyNotFoundException or FormatException or InvalidOperationException or DecoderFallbackException or OverflowException) { return Results.Json(new { error = "NCBI is unavailable or returned an unsupported response. Try later or import a saved record." }, statusCode: 502); }
        }
        app.MapPost("/api/sequences/ncbi/search", (NcbiSearchRequest request, HttpContext context) => Execute(context, token => service.SearchAsync(request, token)));
        app.MapPost("/api/sequences/ncbi/fetch", (NcbiFetchRequest request, HttpContext context) => Execute(context, token => service.FetchAsync(request, token)));
    }
}
