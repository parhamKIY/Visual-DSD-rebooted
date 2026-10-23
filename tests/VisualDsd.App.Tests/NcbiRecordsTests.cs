using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using VisualDsd.App;
using Xunit;

namespace VisualDsd.Tests;

public class NcbiRecordsTests
{
    private sealed class Replies(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(responses[Requests.Count - 1]);
        }
    }
    private static HttpResponseMessage Text(string text, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(text, Encoding.UTF8) };
    [Fact]
    public async Task Search_preserves_query_database_versioned_records_and_encodes_fixed_destination()
    {
        using var handler = new Replies(Text("{\"esearchresult\":{\"count\":\"1\",\"idlist\":[\"123\"]}}"), Text("{\"result\":{\"123\":{\"accessionversion\":\"NM_000518.5\",\"title\":\"Authored test record\",\"slen\":628}}}"));
        using var http = new HttpClient(handler);var service = new NcbiRecords(http);
        var result = JsonSerializer.SerializeToElement(await service.SearchAsync(new("nuccore", "HBB[Gene Name] AND Homo sapiens[Organism]"), default));
        Assert.Equal("NM_000518.5", result.GetProperty("records")[0].GetProperty("accessionVersion").GetString());
        Assert.Equal(628, result.GetProperty("records")[0].GetProperty("length").GetInt32());
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, url => { Assert.Equal("https", url.Scheme);Assert.Equal("eutils.ncbi.nlm.nih.gov", url.Host);Assert.DoesNotContain("api_key", url.Query); });
        Assert.Contains("term=HBB%5BGene%20Name%5D", handler.Requests[0].Query);
    }
    [Fact]
    public async Task No_hits_uses_one_request_and_invalid_queries_never_reach_provider()
    {
        using var handler = new Replies(Text("{\"esearchresult\":{\"count\":\"0\",\"idlist\":[]}}"));using var http = new HttpClient(handler);var service = new NcbiRecords(http);
        Assert.Equal(400, (await Assert.ThrowsAsync<NcbiFailure>(() => service.SearchAsync(new("https://other.example", "x"), default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<NcbiFailure>(() => service.FetchAsync(new("nuccore", "A,B"), default))).Status);
        Assert.Empty(handler.Requests);
        var result = JsonSerializer.SerializeToElement(await service.SearchAsync(new("protein", "absent"), default));Assert.Equal(0, result.GetProperty("count").GetInt32());Assert.Single(handler.Requests);
    }
    [Fact]
    public async Task Fetch_retains_original_text_accession_version_timestamp_and_digest()
    {
        const string source = "LOCUS       TEST 4 bp DNA\nVERSION     NM_000518.5\nORIGIN\n        1 acgt\n//\n";
        using var handler = new Replies(Text(source));using var http = new HttpClient(handler);var service = new NcbiRecords(http);
        var result = JsonSerializer.SerializeToElement(await service.FetchAsync(new("nuccore", "NM_000518.5"), default));
        Assert.Equal(source, result.GetProperty("text").GetString());var metadata = result.GetProperty("retrieval");Assert.Equal("NM_000518.5", metadata.GetProperty("accessionVersion").GetString());Assert.Equal(64, metadata.GetProperty("sha256").GetString()!.Length);Assert.Contains("rettype=gbwithparts", metadata.GetProperty("url").GetString());
    }
    [Fact]
    public async Task Rate_limit_sets_cooldown_and_never_retries_automatically()
    {
        var limited=Text("quota",HttpStatusCode.TooManyRequests);limited.Headers.RetryAfter=new(System.TimeSpan.FromSeconds(60));
        using var handler = new Replies(limited);using var http = new HttpClient(handler);var service = new NcbiRecords(http);
        var first=await Assert.ThrowsAsync<NcbiFailure>(()=>service.FetchAsync(new("protein","NP_000509.1"),default));Assert.Equal(429,first.Status);Assert.Equal(60,first.RetryAfter);
        Assert.Equal(429,(await Assert.ThrowsAsync<NcbiFailure>(()=>service.FetchAsync(new("protein","NP_000509.1"),default))).Status);Assert.Single(handler.Requests);
    }
    [Fact]
    public async Task Oversized_and_nonrecord_responses_fail_explicitly()
    {
        using var handler = new Replies(Text(new string('x',5*1024*1024+1)));using var http = new HttpClient(handler);var service = new NcbiRecords(http);
        Assert.Equal(413,(await Assert.ThrowsAsync<NcbiFailure>(()=>service.FetchAsync(new("nuccore","1"),default))).Status);
        using var otherHandler=new Replies(Text("record not found"));using var otherHttp=new HttpClient(otherHandler);
        Assert.Equal(404,(await Assert.ThrowsAsync<NcbiFailure>(()=>new NcbiRecords(otherHttp).FetchAsync(new("nuccore","1"),default))).Status);
    }
}

[Collection("Process integration")]
public class NcbiEndpointTests(LocalHost host) : IClassFixture<LocalHost>
{
    [Fact]
    public async Task Sequence_assets_are_embedded_and_validation_and_origin_guard_precede_network_access()
    {
        foreach(var asset in new[]{"alignment.js","blast.js","sequence-analysis-state.js","sequence-analysis-workspace.js"})Assert.Equal(HttpStatusCode.OK,(await host.Client.GetAsync("/assets/"+asset)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await host.Client.PostAsJsonAsync("/api/sequences/ncbi/fetch",new NcbiFetchRequest("unknown","x"))).StatusCode);
        using var request=new HttpRequestMessage(HttpMethod.Post,"/api/sequences/ncbi/search"){Content=JsonContent.Create(new NcbiSearchRequest("nuccore","x"))};request.Headers.Add("Origin","https://other.example");
        Assert.Equal(HttpStatusCode.Forbidden,(await host.Client.SendAsync(request)).StatusCode);
    }
}
