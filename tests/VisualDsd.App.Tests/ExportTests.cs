using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Xml.Linq;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class ExportTests
{
    static readonly XNamespace S="http://www.sbml.org/sbml/level3/version2/core", M="http://www.w3.org/1998/Math/MathML";
    static ModelData Run(string code, string solver="oslo",string? node=null,string? system=null,string language="crn")
    {
        var r=CoreEngine.Execute(new(){Code=code,Language=language,Operation="export",Simulator=solver,NodeId=node,SystemId=system});
        Assert.True(r.Success,JsonSerializer.Serialize(r)); Assert.Empty(r.Model!.Simulations);return r.Model;
    }
    static ExportData File(ModelData model,string id)
    {
        var file=Assert.Single(model.Exports!,f=>f.Id==id);Assert.Null(file.Diagnostic);Assert.False(string.IsNullOrWhiteSpace(file.Content));return file;
    }
    static XElement Sbml(ModelData model)=>XDocument.Parse(File(model,"sbml").Content!).Root!.Element(S+"model")!;
    static double Number(XAttribute? value)=>double.Parse(value!.Value,CultureInfo.InvariantCulture);
    static double MathValue(XElement element,Dictionary<string,double> values,double time=0)
    {
        var parts=element.Elements().ToArray();
        if(element.Name==M+"ci")return values[element.Value];
        if(element.Name==M+"csymbol")return time;
        if(element.Name==M+"cn")return element.Attribute("type")?.Value=="e-notation"?double.Parse(string.Concat(element.Nodes().TakeWhile(n=>n is not XElement)),CultureInfo.InvariantCulture)*Math.Pow(10,double.Parse(string.Concat(element.Nodes().SkipWhile(n=>n is not XElement).Skip(1)),CultureInfo.InvariantCulture)):double.Parse(element.Value,CultureInfo.InvariantCulture);
        if(element.Name==M+"piecewise"){
            foreach(var piece in parts){if(piece.Name==M+"otherwise" || MathValue(piece.Elements().Last(),values,time)!=0)return MathValue(piece.Elements().First(),values,time);}
        }
        var args=parts.Skip(1).Select(e=>MathValue(e,values,time)).ToArray();
        return parts[0].Name.LocalName switch {
            "plus"=>args.Sum(),"times"=>args.Aggregate(1.0,(a,b)=>a*b),"minus"=>args.Length==1?-args[0]:args[0]-args[1],"divide"=>args[0]/args[1],"power"=>Math.Pow(args[0],args[1]),"abs"=>Math.Abs(args[0]),"ln"=>Math.Log(args[0]),"ceiling"=>Math.Ceiling(args[0]),"floor"=>Math.Floor(args[0]),
            "lt"=>args[0]<args[1]?1:0,"leq"=>args[0]<=args[1]?1:0,"eq"=>args[0]==args[1]?1:0,"geq"=>args[0]>=args[1]?1:0,"gt"=>args[0]>args[1]?1:0,"not"=>args[0]==0?1:0,"and"=>args.All(a=>a!=0)?1:0,"or"=>args.Any(a=>a!=0)?1:0,_=>throw new Exception(element.ToString())};
    }
    static double Flux(XElement model,int reaction,params (string,double)[] populations)
    {
        var values=model.Descendants(S+"species").ToDictionary(sp=>sp.Attribute("id")!.Value,sp=>populations.FirstOrDefault(p=>p.Item1==sp.Attribute("name")!.Value).Item2);values["c"]=1;
        return MathValue(model.Descendants(S+"kineticLaw").ElementAt(reaction).Element(M+"math")!.Elements().Single(),values);
    }

    [Fact]
    public void Export_has_six_real_files_and_a_round_trippable_resolved_model()
    {
        var model=Run(CrnTests.Decay);Assert.Equal(6,model.Exports!.Length);
        foreach(var file in model.Exports!){Assert.Null(file.Diagnostic);Assert.NotEmpty(file.Content!);if(file.ContentType.Contains("xml"))Assert.NotNull(XDocument.Parse(file.Content!).Root);}
        var source=File(model,"code").Content!;
        var parsed=CoreEngine.Execute(new(){Code=source,Language="crn",Operation="simulate"});Assert.True(parsed.Success);
        Assert.Equal(10*Math.Exp(-.5),parsed.Model!.Simulations[0].Series[0].Values[^1],3);
        Assert.StartsWith("function sol = crn_export_run_001()",File(model,"matlab").Content);
        Assert.Equal("crn_export_run_001.m",File(model,"matlab").FileName);
        Assert.Contains("\\begin{align*}",File(model,"equations").Content);
    }
    [Theory]
    [InlineData("oslo","Deterministic",2)]
    [InlineData("oslo","Stochastic",1)]
    [InlineData("sundials","Deterministic",2)]
    [InlineData("sundials","Stochastic",2)]
    public void Repeated_reactant_flux_preserves_the_selected_ODE_engines_conversion(string solver,string kinetics,double coefficient)
    {
        var model=Sbml(Run($"directive simulation {{kinetics={kinetics}}} | 3 A | A + A ->{{2}} B",solver));
        Assert.Equal(coefficient*9,Flux(model,0,("A",3)));
    }
    [Fact]
    public void Functional_named_rates_time_constants_and_units_survive_SBML()
    {
        var model=Sbml(Run("directive units {time=min;concentration=uM}\ndirective parameters [k=2]\ndirective rates [loss=k*[A]+[time]] | constant 3 A | A ->[[loss]] B"));
        var time=model.Descendants(S+"unitDefinition").Single(e=>e.Attribute("id")!.Value=="model_time");Assert.Equal(60,Number(time.Descendants(S+"unit").Single().Attribute("multiplier")));
        var substance=model.Descendants(S+"unitDefinition").Single(e=>e.Attribute("id")!.Value=="model_substance");Assert.Equal(-6,Number(substance.Descendants(S+"unit").Single().Attribute("scale")));
        var species=model.Descendants(S+"species").Single(e=>e.Attribute("name")!.Value=="A");Assert.Equal("true",species.Attribute("boundaryCondition")!.Value);
        var timeSymbol=Assert.Single(model.Descendants(M+"csymbol"));Assert.Equal("http://www.sbml.org/sbml/symbols/time",timeSymbol.Attribute("definitionURL")!.Value);
        var values=new Dictionary<string,double>{{"s1",3},{"s2",0},{"c",1}};Assert.Equal(11,MathValue(model.Descendants(M+"math").Single().Elements().Single(),values,5));
        Assert.Contains("<ci>c</ci>",model.ToString());
    }
    [Fact]
    public void Catalysts_and_reverse_reactions_have_correct_flux_and_stoichiometry()
    {
        var model=Sbml(Run("| 2 C | 3 A | 4 B | C ~ A <->{2}{3} B"));
        Assert.Equal(2,model.Descendants(S+"reaction").Count());
        Assert.Equal(12,Flux(model,0,("A",3),("C",2),("B",4)));Assert.Equal(24,Flux(model,1,("A",3),("C",2),("B",4)));
    }
    [Theory]
    [InlineData(-3.5,-1.5)] [InlineData(-2.5,-1.5)] [InlineData(.5,.5)] [InlineData(1.5,3.5)] [InlineData(2.5,4.5)]
    public void Banker_rounding_and_signed_modulo_are_portable(double a,double expected)
    {
        var model=Sbml(Run("| 1 A | ->[round([A])+([A]%3)] B"));
        Assert.Equal(expected,Flux(model,0,("A",a)),10);
    }
    [Fact]
    public void Every_sweep_export_is_fixed_to_its_own_assignment()
    {
        string code="directive simulator deterministic\ndirective simulation {final=1;points=5;plots=[A];sweeps=[doses]}\ndirective parameters [N=10;k=0.5]\ndirective sweeps [doses=[N=[2;5]]]\n| N A | A ->{k} B";
        var files=Run(code).Exports!;Assert.Equal(12,files.Length);Assert.Equal(12,files.Select(f=>f.FileName).Distinct().Count());
        foreach(var (file,expected) in files.Where(f=>f.Id=="code").Zip(new[]{2.0,5.0})){
            var r=CoreEngine.Execute(new(){Code=file.Content!,Language="crn",Operation="simulate"});Assert.True(r.Success,JsonSerializer.Serialize(r));var run=Assert.Single(r.Model!.Simulations);Assert.Equal(expected,run.Series[0].Values[0]);
        }
    }
    [Fact]
    public void Selected_graph_system_and_lifted_names_export_without_identifier_corruption()
    {
        var model=Run(CrnTests.Graph,node:"second",system:"fast");Assert.Equal("second",model.Program!.SelectedNodeId);
        var sbml=Sbml(model);Assert.Equal(20,Number(sbml.Descendants(S+"species").Single(e=>e.Attribute("name")!.Value=="A").Attribute("initialConcentration")));Assert.Equal(20,Flux(sbml,0,("A",20)));
    }
    [Theory]
    [InlineData("| 1 A @ 1","oslo")]
    [InlineData("| 1 A","pde")]
    [InlineData("| 1 A","ssa")]
    public void Unsupported_dynamics_produce_diagnostics_instead_of_fake_files(string code,string solver)
    {
        var model=Run(code,solver);var file=Assert.Single(model.Exports!,f=>f.Id=="sbml");Assert.Null(file.Content);Assert.Equal("EXPORT_UNSUPPORTED",file.Diagnostic!.Code);Assert.NotNull(File(model,"code").Content);
    }
    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Closure_MATLAB_uses_the_configured_zero_initial_minimum_and_array_identifiers(bool log)
    {
        var model=Run($"directive moments {{order=2;plots=[<A>; <A^2>];initial_minimum=1e-8;log_evaluation={log.ToString().ToLowerInvariant()}}}\ndirective simulation {{final=1;points=10}} | 0 A | ->{{2}} A | A ->{{0.1}}","mc");
        Assert.Equal(9,model.Exports!.Length);foreach(var f in model.Exports!)Assert.Null(f.Diagnostic);
        var text=File(model,"closure-matlab").Content!;Assert.Contains("crn_closure_run_001()",text);Assert.DoesNotContain("ones(",text);Assert.Contains("max(x,1E-08)",text);var initial=text.Split("x0 = [")[1].Split("];")[0].Split(';').Select(v=>double.Parse(v,CultureInfo.InvariantCulture)).Order().ToArray();Assert.Equal(2,initial.Length);Assert.InRange(initial[0],0.999999e-16,1.000001e-16);Assert.Equal(1e-8,initial[1]);
        Assert.Contains("\\begin{align*}",File(model,"closure").Content);
    }
    [Fact]
    public void DSD_scientific_exports_preserve_molecular_drawings()
    {
        var model=Run(ScientificTests.Decay,language:"dsd");Assert.Equal("classic",model.Kind);Assert.Contains("<svg",File(model,"initials").Content);Assert.Contains("<svg",File(model,"reactions").Content);Assert.NotNull(Sbml(model));
    }
    [Fact]
    public void JIT_export_is_rejected_without_materializing_an_infinite_network()
    {
        var r=CoreEngine.Execute(new(){Code="directive compilation infinite\ndirective jit\n< a b >",Operation="export"});Assert.False(r.Success);Assert.Contains(r.Diagnostics,d=>d.Code=="JIT_EXPORT");
    }
}

public class ExportIntegrationTests(LocalHost host):IClassFixture<LocalHost>
{
    [Fact]
    public async Task Export_completes_through_the_isolated_API_worker()
    {
        var response=await host.Client.PostAsJsonAsync("/api/jobs",new ModelRequest{Code=CrnTests.Decay,Language="crn",Operation="export"});response.EnsureSuccessStatusCode();
        var job=await response.Content.ReadFromJsonAsync<JobView>();var done=await host.FinishAsync(job!.Id);Assert.Equal("succeeded",done.State);Assert.Equal(6,done.Result!.Model!.Exports!.Length);Assert.All(done.Result.Model.Exports,f=>Assert.Null(f.Diagnostic));
        var asset=await host.Client.GetAsync("/assets/exports.js");asset.EnsureSuccessStatusCode();Assert.Contains("readExports",await asset.Content.ReadAsStringAsync());
    }
}
