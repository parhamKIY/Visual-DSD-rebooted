using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class SynthesisTests
{
    public const string Bistable = "directive synthesis {mode=multistability;solver=nlsat;timeout=5;seed=7}\ndirective simulation {final=20;points=40;plots=[X;Y]}\n| 0.5 X | 0.5 Y | ->{6} X | X ->{11} | X + X ->{6} 3X | 3X ->{1} 2X | X ->{1} X + Y | Y ->{1}";
    public const string Turing = "directive synthesis {mode=turing;solver=nlsat;timeout=5;seed=7}\ndirective parameters [DY=20,{interval=Real;distribution=Uniform(10,30);variation=Random}]\ndirective spatial {diffusibles=[X=1;Y=DY]}\n| 1 X | 1.8 Y | ->{1} X | X ->{1} | X ->{1.8} Y | X + X + Y ->{1} 3X";
    static EngineResponse Execute(string code, int trajectories = 0, string? x = null, string? y = null) => CoreEngine.Execute(new() { Code=code,Language="crn",Operation="synthesize",PhaseTrajectories=trajectories,PhaseX=x,PhaseY=y });
    static SynthesisData Run(string code,int trajectories=0,string? x=null,string? y=null)
    {
        var result=Execute(code,trajectories,x,y);
        Assert.True(result.Success,JsonSerializer.Serialize(result));
        return Assert.IsType<SynthesisData>(result.Model!.Synthesis);
    }

    [Theory]
    [InlineData("nlsat")]
    [InlineData("portfolio")]
    public void Multistability_returns_two_actual_distinct_stable_roots(string solver)
    {
        var result=Run(Bistable.Replace("solver=nlsat","solver="+solver));
        Assert.Equal("SAT",result.Status); Assert.Equal(solver,result.Solver);
        var roots=result.Equilibria.OrderBy(e=>e.Values[0]).ToArray(); Assert.Equal(2,roots.Length);
        Assert.Equal(new[]{"X","Y"},roots[0].Species);
        for(int i=0;i<2;i++)
        {
            double root=i==0?1:3;
            Assert.All(roots[i].Values,v=>Assert.InRange(v,root-1e-10,root+1e-10));
            Assert.All(roots[i].Residuals,v=>Assert.InRange(Math.Abs(v),0,1e-10));
            Assert.InRange(roots[i].MaximumRealEigenvalue,-1.00000001,-.99999999);
            Assert.InRange(roots[i].Jacobian[0][0],-2.00000001,-1.99999999);
            Assert.Equal(1,roots[i].Jacobian[1][0]); Assert.Equal(-1,roots[i].Jacobian[1][1]);
        }
    }

    [Fact]
    public void Turing_witness_has_an_independently_checked_diffusion_instability()
    {
        var result=Run(Turing); Assert.Equal("SAT",result.Status);
        var eq=Assert.Single(result.Equilibria); Assert.Equal(1,eq.Values[0],10); Assert.Equal(1.8,eq.Values[1],10);
        Assert.All(eq.Residuals,v=>Assert.InRange(Math.Abs(v),0,1e-10));
        Assert.InRange(eq.MaximumRealEigenvalue,-.10000001,-.09999999);
        var d=Assert.Single(result.Values,p=>p.Name=="DY").Value; Assert.InRange(d,10,30);
        var dispersion=Assert.IsType<DispersionData>(result.Dispersion);
        Assert.True(dispersion.WitnessGrowthRate>0); Assert.True(dispersion.WitnessWaveNumber>0);
        // det(J-q²D) < 0 and trace(J-q²D) < 0 imply one positive real eigenvalue.
        double q2=dispersion.WitnessWaveNumber*dispersion.WitnessWaveNumber;
        double determinant=(.8-q2)*(-1-d*q2)+1.8;
        double trace=-.2-(1+d)*q2;
        Assert.True(determinant<0); Assert.True(trace<0);
        double lambda=(trace+Math.Sqrt(trace*trace-4*determinant))/2;
        Assert.Equal(lambda,dispersion.WitnessGrowthRate,9);
        Assert.Equal(eq.MaximumRealEigenvalue,dispersion.GrowthRates[0],9);
        Assert.Null(result.PhasePortrait); Assert.NotNull(result.Code);
        var parsed=CoreEngine.Execute(new(){Code=result.Code!,Language="crn",Operation="parse"}); Assert.True(parsed.Success);
    }

    [Fact]
    public void Linear_decay_is_unsatisfiable_and_has_no_fabricated_witness()
    {
        var result=Run("directive synthesis {solver=nlsat;timeout=5} | 1 X | ->{1} X | X ->{1}");
        Assert.Equal("UNSAT",result.Status); Assert.Empty(result.Values); Assert.Empty(result.Equilibria);
        Assert.Null(result.Code); Assert.Null(result.PhasePortrait); Assert.Null(result.Dispersion);
    }

    [Fact]
    public void Phase_portraits_are_seeded_preserve_initials_and_report_distance_without_claiming_convergence()
    {
        var first=Run(Bistable,4,"Y","X"); var second=Run(Bistable,4,"Y","X");
        var phase=Assert.IsType<PhasePortraitData>(first.PhasePortrait);
        Assert.Equal("Y",phase.SpeciesX); Assert.Equal("X",phase.SpeciesY);
        Assert.Equal(JsonSerializer.Serialize(phase),JsonSerializer.Serialize(second.PhasePortrait));
        Assert.Equal(4,phase.Trajectories.Length);
        Assert.All(phase.Trajectories,t=>
        {
            Assert.Equal(t.InitialX,t.X[0],10);Assert.Equal(t.InitialY,t.Y[0],10);
            Assert.Equal(t.Times.Length,t.X.Length);Assert.Equal(t.Times.Length,t.Y.Length);
            double[] distances=Enumerable.Range(0,2).Select(i=>Math.Sqrt(Math.Pow(t.X[^1]-phase.EquilibriumX[i],2)+Math.Pow(t.Y[^1]-phase.EquilibriumY[i],2))).ToArray();
            Assert.Equal(distances.Min(),t.FinalDistance,10); Assert.Equal(Array.IndexOf(distances,distances.Min()),t.NearestEquilibrium);
        });
    }

    [Fact]
    public void Solver_and_export_do_not_depend_on_decimal_comma_culture()
    {
        var previous=CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture=CultureInfo.GetCultureInfo("fr-FR");
            var result=Run(Turing); Assert.Equal("SAT",result.Status);
            var parsed=CoreEngine.Execute(new(){Code=result.Code!,Language="crn",Operation="parse"});
            Assert.True(parsed.Success,JsonSerializer.Serialize(parsed));
        }
        finally { CultureInfo.CurrentCulture=previous; }
    }

    [Theory]
    [InlineData("timeout=0","SYNTHESIS_TIMEOUT")]
    [InlineData("timeout=-1","SYNTHESIS_TIMEOUT")]
    [InlineData("timeout=31","SYNTHESIS_TIMEOUT")]
    public void Invalid_solver_timeouts_are_explicit(string option,string code)
    {
        var result=Execute(Bistable.Replace("timeout=5",option)); Assert.False(result.Success); Assert.Equal(code,Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Wave_variable_collisions_and_invalid_phase_selections_fail_explicitly()
    {
        var collision=Execute("directive parameters [wc=1]\n"+Bistable); Assert.False(collision.Success);Assert.Equal("SYNTHESIS_NAMES",Assert.Single(collision.Diagnostics).Code);
        var phase=Execute(Bistable,2,"X","X");Assert.False(phase.Success);Assert.Equal("SYNTHESIS_PHASE",Assert.Single(phase.Diagnostics).Code);
        var missing=Execute(Bistable,2,"X","missing");Assert.False(missing.Success);
    }

    [Fact]
    public void Selected_system_is_synthesized_without_fitting_other_nodes()
    {
        string code="system stable = { | 1 X | ->{1} X | X ->{1} }\nsystem bistable = { "+Bistable+" }";
        var result=CoreEngine.Execute(new(){Code=code,Language="crn",Operation="synthesize",SystemId="bistable",PhaseTrajectories=0});
        Assert.True(result.Success,JsonSerializer.Serialize(result)); Assert.Equal("SAT",result.Model!.Synthesis!.Status); Assert.Equal("bistable",result.Model.Program!.SelectedSystemId);
    }

    [Fact]
    public void Expanded_dsd_reactions_can_use_the_same_synthesis_operation()
    {
        string code="directive synthesis {solver=nlsat;timeout=5}\n(1 * <x> | rxn ->[6+6*[<x>]^2] <x> | rxn <x> ->[11*[<x>]+[<x>]^3])";
        var result=CoreEngine.Execute(new(){Code=code,Operation="synthesize",PhaseTrajectories=0});
        Assert.True(result.Success,JsonSerializer.Serialize(result)); Assert.Equal("SAT",result.Model!.Synthesis!.Status);
    }

    [Theory]
    [InlineData("directive simulation {sweeps=[s]}\ndirective sweeps [s=[k=[1;2]]]\ndirective parameters [k=1]\n| 1 X | X ->{k}","SYNTHESIS_BATCH")]
    [InlineData("directive simulation {final=2}\n| init X 1 @ 1 | X ->{1}","SYNTHESIS_INITIALS")]
    [InlineData("directive synthesis {mode=turing}\n| 1 X | ->{1} X | X ->{1}","SYNTHESIS_DIFFUSION")]
    [InlineData("| 1 X | ->[log([X])] X | X ->{1}","SYNTHESIS_EXPRESSION")]
    public void Unsupported_symbolic_scopes_are_reported_explicitly(string code,string diagnostic)
    {
        var result=Execute(code);Assert.False(result.Success);Assert.Equal(diagnostic,Assert.Single(result.Diagnostics).Code);
    }

    [Fact]
    public void Frozen_stability_sources_keep_their_original_hashes()
    {
        string root=Path.Combine(LocalHost.Root,"upstream","stability-z3");
        using var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(root,"snapshot.json")));
        var files=manifest.RootElement.GetProperty("files").EnumerateArray().ToArray();Assert.Equal(17,files.Length);
        foreach(var file in files)
        {
            string path=Path.Combine(root,file.GetProperty("path").GetString()!);
            Assert.Equal(file.GetProperty("sha256").GetString(),Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant());
        }
    }
}
