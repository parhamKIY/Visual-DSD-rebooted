using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using VisualDsd.App;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class DsdWorkspaceTests
{
    private static ModelData Execute(ModelRequest request)
    {
        var result=CoreEngine.Execute(request);
        Assert.True(result.Success,JsonSerializer.Serialize(result));
        return result.Model!;
    }

    [Fact]
    public void Overrides_apply_before_domain_declaration_checks_and_preserve_source_settings()
    {
        var rejected=CoreEngine.Execute(new(){Code="<a^ b>",DsdOptions=new(){DeclareDomains=true}});
        Assert.False(rejected.Success);
        var accepted=Execute(new(){Code="directive declare\n<a^ b>",DsdOptions=new(){DeclareDomains=false}});
        Assert.False(accepted.Dsd!.Options.DeclareDomains);
        var source=Execute(new(){Code="directive leaks\n<a^ b>"});
        Assert.True(source.Dsd!.Options.Leaks);
        var overridden=Execute(new(){Code="directive leaks\n<a^ b>",DsdOptions=new(){Leaks=false,PinLeaks=false,Polymers=true,Unproductive=true,ColourToeholds=false,PlotNames=false,StateImages=false,ToeholdLength=7,SpecificityLength=23,Temperature=19,Predicates="none",Renderer="branches",RenderMode="condensed",Arrange="babylon",RotateLabels=false}});
        var options=overridden.Dsd!.Options;
        Assert.False(options.Leaks);Assert.False(options.PinLeaks);Assert.True(options.Polymers);Assert.True(options.Unproductive);
        Assert.False(options.ColourToeholds);Assert.False(options.PlotNames);Assert.False(options.StateImages);
        Assert.Equal(7,options.ToeholdLength);Assert.Equal(23,options.SpecificityLength);Assert.Equal(19,options.Temperature);
        Assert.Equal("none",options.Predicates);Assert.Equal("branches",options.Renderer);Assert.Equal("condensed",options.RenderMode);Assert.Equal("babylon",options.Arrange);Assert.False(options.RotateLabels);
    }

    [Fact]
    public void Rate_overrides_change_the_generated_reaction_network()
    {
        const string code="(<a^ b> | {a^*}[b])";
        var original=Execute(new(){Code=code,Operation="expand"});
        var changed=Execute(new(){Code=code,Operation="expand",Compilation="detailed",DsdOptions=new(){ToeholdBindRate=.037,ToeholdUnbindRate=.19}});
        Assert.Equal(.037,changed.Dsd!.Options.ToeholdBindRate);Assert.Equal(.19,changed.Dsd.Options.ToeholdUnbindRate);
        Assert.NotEqual(JsonSerializer.Serialize(original.Reactions),JsonSerializer.Serialize(changed.Reactions));
        Assert.Contains(changed.Reactions,r=>r.Rate.Expression.Contains("0.037") || r.ReverseRate?.Expression.Contains("0.037")==true);
    }

    [Fact]
    public void Assigned_DNA_and_reverse_complements_come_from_the_actual_compiler_mapping()
    {
        var model=Execute(new(){Code="<a^ b>",Toeholds="ACGTAC",Specificities="AACCGGTTAA"});
        var data=model.Dsd!;
        Assert.Equal("assigned",data.SequenceStatus);Assert.Equal(2,data.Sequences.Length);
        var toe=Assert.Single(data.Sequences.Where(s=>s.IsToehold));
        Assert.Equal("ACGTAC",toe.Sequence);Assert.Equal("GTACGT",toe.ReverseComplement);
        var spec=Assert.Single(data.Sequences.Where(s=>!s.IsToehold));
        Assert.Equal("AACCGGTTAA",spec.Sequence);Assert.Equal("TTAACCGGTT",spec.ReverseComplement);
        Assert.Equal(0,data.RemainingToeholds);Assert.Equal(0,data.RemainingSpecificities);
        var incomplete=Execute(new(){Code="<a^ b>",Toeholds="",Specificities=""}).Dsd!;
        Assert.Equal("incomplete",incomplete.SequenceStatus);
        Assert.All(incomplete.Sequences,s=>{Assert.Null(s.Sequence);Assert.Null(s.ReverseComplement);});
    }

    [Fact]
    public void Check_DNA_override_controls_the_original_duplicate_database_check()
    {
        var request=new ModelRequest{Code="<a^ b>",Toeholds="ACGTAC\nACGTAC",Specificities="AACCGGTTAA"};
        Assert.False(CoreEngine.Execute(request).Success);
        var model=Execute(request with{DsdOptions=new(){CheckDna=false}});
        Assert.False(model.Dsd!.Options.CheckDna);Assert.Equal("assigned",model.Dsd.SequenceStatus);
    }

    [Theory]
    [InlineData("classic","complement")]
    [InlineData("circles","nucleotides")]
    [InlineData("branches","condensed")]
    public void Render_overrides_produce_real_molecular_graphics(string renderer,string mode)
    {
        var model=Execute(new(){Code="(<a^ b> | {a^*}[b])",Operation="expand",DsdOptions=new(){Renderer=renderer,RenderMode=mode}});
        Assert.Equal(renderer,model.Dsd!.Options.Renderer);Assert.Equal(mode,model.Dsd.Options.RenderMode);
        Assert.All(model.Species,s=>Assert.Contains("<svg",s.Svg));Assert.NotEmpty(model.Reactions);
    }

    [Fact]
    public void JIT_override_is_applied_before_operation_selection()
    {
        var model=Execute(new(){Code="directive jit\n<a>",Operation="expand",DsdOptions=new(){Jit=false}});
        Assert.False(model.IsJit);Assert.False(model.Dsd!.Options.Jit);
        var jit=Execute(new(){Code="<a>",Operation="simulate",Simulator="ssa",Final=1,Points=3,DsdOptions=new(){Jit=true}});
        Assert.True(jit.IsJit);Assert.True(jit.Dsd!.Options.Jit);
    }

    [Fact]
    public void Invalid_and_language_incompatible_options_are_rejected()
    {
        foreach(var options in new DsdOptionsData[]{new(){Renderer="unknown"},new(){RenderMode="bad"},new(){Arrange="bad"},new(){Predicates="bad"},new(){ToeholdLength=0},new(){SpecificityLength=257},new(){Temperature=-273.15},new(){Temperature=1001},new(){ToeholdBindRate=-1},new(){ToeholdUnbindRate=double.NaN}})
            Assert.Contains(RequestValidation.Validate(new(){Code="<a>",DsdOptions=options}),d=>d.Code=="DSD_OPTIONS");
        Assert.Contains(RequestValidation.Validate(new(){Code="A",Language="crn",DsdOptions=new()}),d=>d.Code=="CRN_OPTIONS");
        Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<DsdOptionsData>("{\"imaginary\":true}",ProcessEngineWorker.Json));
        Assert.Null(Execute(new(){Code="| 1 A",Language="crn"}).Dsd);
    }
}

[Collection("Process integration")]
public class DsdLibraryTests(LocalHost host) : IClassFixture<LocalHost>
{
    [Fact]
    public async Task Every_original_source_is_embedded_without_modification_and_has_an_independently_verified_hash()
    {
        var catalog=(await host.Client.GetFromJsonAsync<ExampleInfo[]>("/api/examples"))!;
        var originals=catalog.Where(e=>e.Source is not null).ToArray();
        string root=Path.Combine(LocalHost.Root,"upstream","crn-engine","ClassicDSD","Examples","DSDModels");
        var sources=Directory.EnumerateFiles(root,"*",SearchOption.AllDirectories).Where(f=>Path.GetExtension(f) is ".txt" or ".dna").ToArray();
        Assert.Equal(108,originals.Length);Assert.Equal(126,catalog.Length);Assert.Equal(sources.Length,originals.Length);
        Assert.Equal(catalog.Length,catalog.Select(e=>e.Id).Distinct().Count());
        foreach(var item in originals)
        {
            var file=Path.Combine(root,item.Source!.Replace('/',Path.DirectorySeparatorChar));
            Assert.Contains(file,sources);Assert.StartsWith("Original",item.Category);
            Assert.Equal(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(file))).ToLowerInvariant(),item.Sha256);
            var model=(await host.Client.GetFromJsonAsync<ExampleModel>($"/api/examples/{item.Id}"))!;
            Assert.Equal(await File.ReadAllTextAsync(file),model.Code);Assert.Equal(item.Source,model.Source);Assert.Equal(item.Category,model.Category);
        }
    }

    [Fact]
    public async Task Sequence_defaults_are_authoritative_and_module_is_embedded()
    {
        var databases=(await host.Client.GetFromJsonAsync<SequenceDatabasesData>("/api/sequences/defaults"))!;
        Assert.Equal(CoreEngine.SequenceDatabases,databases);
        Assert.NotEmpty(databases.Toeholds);Assert.NotEmpty(databases.Specificities);
        Assert.True((await host.Client.GetAsync("/assets/dsd-workspace.js")).IsSuccessStatusCode);
    }

    [Theory]
    [InlineData("Manual/Join-Nucleotides.txt","assigned")]
    [InlineData("RulesDSD/join_simple.txt","unavailable")]
    [InlineData("Localization - AND gate.txt","assigned")]
    [InlineData("CatalyticSequenceRates.txt","assigned")]
    public async Task Representative_original_sources_complete_through_the_isolated_worker(string source,string status)
    {
        var info=(await host.Client.GetFromJsonAsync<ExampleInfo[]>("/api/examples"))!.Single(e=>e.Source==source);
        var example=(await host.Client.GetFromJsonAsync<ExampleModel>($"/api/examples/{info.Id}"))!;
        var created=await host.Client.PostAsJsonAsync("/api/jobs",new ModelRequest{Code=example.Code,Dialect=example.Dialect,Operation="parse"});
        Assert.True(created.IsSuccessStatusCode);
        var job=await host.FinishAsync((await created.Content.ReadFromJsonAsync<JobView>())!.Id);
        Assert.Equal("succeeded",job.State);Assert.Equal(status,job.Result!.Model!.Dsd!.SequenceStatus);
    }
}
