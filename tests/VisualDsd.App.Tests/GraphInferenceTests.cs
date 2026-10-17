using System.Text.Json;
using VisualDsd.Contracts;
using Xunit;
using CoreEngine = VisualDsd.Engine.Engine;

namespace VisualDsd.Tests;

public class GraphInferenceTests
{
    const string Header = "directive simulator deterministic\ndirective simulation {final=2;points=10;plots=[A]}\ndirective inference {burnin=100;samples=120;thin=4;seeds=[11;29];noise_parameter=Fixed(0.1)}\ndirective parameters [k=0.3,{interval=Real;distribution=Uniform(0.1,0.8);variation=Random}]\n";
    const string Standalone = Header+"directive data [dose]\n| 10 A | A ->{k} B";
    const string Systems = Header+"system low = { directive data [low] | 10 A | A ->{k} B }\nsystem high = { directive data [high] | 20 A | A ->{k} B }";
    static DatasetData Data(string name,double initial) => new(name,[new(Enumerable.Range(0,5).Select(i=>i*.5).ToArray(),[new("A",Enumerable.Range(0,5).Select(i=>initial*Math.Exp(-.35*i*.5)).ToArray())])]);
    static ModelData Run(string code,DatasetData[] data,string? node=null,string solver="source")
    {
        var response=CoreEngine.Execute(new(){Code=code,Language="crn",Operation="infer",Data=data,NodeId=node,Simulator=solver});
        Assert.True(response.Success,JsonSerializer.Serialize(response)); return response.Model!;
    }

    [Theory]
    [InlineData("source")]
    [InlineData("sundials")]
    public void Seeded_chains_are_independent_reproducible_and_pool_their_actual_samples(string solver)
    {
        var model=Run(Standalone,[Data("dose",10)],solver:solver); var fit=model.Inference!;
        Assert.Equal(new long[]{11,29},fit.Chains!.Select(c=>c.Seed));
        Assert.All(fit.Chains,c=>Assert.True(c.Included)); Assert.Equal(60,fit.RetainedSamples);
        var p=fit.Parameters.Single(p=>p.Name=="k");
        Assert.Equal(fit.Chains!.SelectMany(c=>c.Parameters.Single(p=>p.Name=="k").Samples),p.Samples);
        Assert.Equal(p.Samples.Average(),p.Mean,10);
        Assert.InRange(p.Mle,.32,.38); Assert.NotNull(p.SplitRHat);
        Assert.NotEqual(fit.Chains![0].Parameters[0].Samples,fit.Chains![1].Parameters[0].Samples);
        Assert.Equal(fit.Chains!.SelectMany(c=>c.LogLikelihood),fit.LogLikelihood);
        Assert.Equal(fit.Chains.Max(c=>c.MaxLogLikelihood),fit.MaxLogLikelihood);
        Assert.Equal(JsonSerializer.Serialize(model),JsonSerializer.Serialize(Run(Standalone,[Data("dose",10)],solver:solver)));
    }

    [Fact]
    public void Likelihood_filter_preserves_excluded_chains_and_only_pools_included_draws()
    {
        var first=Run(Standalone,[Data("dose",10)]).Inference!;
        var lo=first.Chains!.Min(c=>c.MaxLogLikelihood); var hi=first.Chains!.Max(c=>c.MaxLogLikelihood);
        Assert.True(hi>lo);
        var fit=Run(Standalone.Replace("seeds=[11;29]",FormattableString.Invariant($"seeds=[11;29];lowerbound={(lo+hi)/2:R}")),[Data("dose",10)]).Inference!;
        Assert.Single(fit.Chains!,c=>c.Included); Assert.Single(fit.Chains!,c=>!c.Included);
        Assert.Equal(30,fit.RetainedSamples); Assert.Null(fit.Parameters[0].SplitRHat);
    }

    [Fact]
    public void Joint_system_inference_shares_global_parameters_and_keeps_each_network_and_dataset()
    {
        var model=Run(Systems,[Data("low",10),Data("high",20)]);
        Assert.Equal(2,model.Simulations.Length); Assert.Equal(10,model.Inference!.DataPoints);
        Assert.Single(model.Inference!.Parameters,p=>p.Kind=="model");
        Assert.Equal(new double[]{10,20},model.Simulations.Select(r=>r.Series[0].Values[0]));
        Assert.All(model.Simulations,r=>Assert.NotNull(r.Network));
        Assert.InRange(model.Inference!.Parameters.Single(p=>p.Name=="k").Mle,.32,.38);
    }

    [Theory]
    [InlineData("Normal")]
    [InlineData("LogNormal")]
    [InlineData("TruncatedNormal")]
    public void Linked_nodes_fit_in_dependency_order_and_propagate_pooled_posteriors(string kind)
    {
        var code=Systems+$"\nnode calibration {{systems=[low]}}\nnode validation {{systems=[high]}}\nedge calibration -> [k={kind}] validation";
        var model=Run(code,[Data("low",10),Data("high",20)],"validation");
        Assert.Equal(new[]{"calibration","validation"},model.InferenceNodes!.Select(n=>n.NodeId));
        Assert.StartsWith(kind+"(",model.Inference!.Priors!.Single(p=>p.Name=="k").Distribution);
        Assert.Equal(20,model.Simulations[0].Series[0].Values[0]);
        Assert.InRange(model.Inference!.Parameters.Single(p=>p.Name=="k").Mle,.32,.38);
    }

    [Fact]
    public void System_local_parameter_links_use_the_lifted_parameter_names()
    {
        string code=Systems.Replace("directive data [low]","directive parameters [q=0.3,{interval=Real;distribution=Uniform(0.1,0.8);variation=Random}] directive data [low]").Replace("directive data [high]","directive parameters [q=0.3,{interval=Real;distribution=Uniform(0.1,0.8);variation=Random}] directive data [high]").Replace("A ->{k} B","A ->{q} B")+"\nnode calibration {systems=[low]}\nnode validation {systems=[high]}\nedge calibration.low -> [q=Normal] validation.high";
        var model=Run(code,[Data("low",10),Data("high",20)],"validation");
        Assert.StartsWith("Normal(",model.Inference!.Priors!.Single(p=>p.Name=="high.q").Distribution);
        Assert.Single(model.Inference!.Parameters,p=>p.Name=="high.q");
    }

    [Theory]
    [InlineData("seeds=[11;11]","INFERENCE_CHAINS")]
    [InlineData("seeds=[1;2;3;4;5]","INFERENCE_CHAINS")]
    [InlineData("seeds=[11;29];lowerbound=1e10","INFERENCE_CHAINS")]
    [InlineData("seeds=[11;29];burnin=10000;samples=10000","INFERENCE_LIMIT")]
    public void Invalid_chains_and_excessive_combined_work_fail_without_partial_results(string replacement,string code)
    {
        var response=CoreEngine.Execute(new(){Code=Standalone.Replace("seeds=[11;29]",replacement),Language="crn",Operation="infer",Data=[Data("dose",10)]});
        Assert.False(response.Success); Assert.Null(response.Model); Assert.Equal(code,Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public void Lognormal_transfer_reconstructs_the_source_mean_and_variance()
    {
        // Exercise the maintained core conversion independently of MCMC mixing.
        var configured=new Microsoft.Research.CRNEngine.ParameterSummary("x",2,2,.5,2,.1,10,1,3,1,3,Microsoft.Research.CRNEngine.Interval.Real);
        var d=configured.toLogNormalDist();
        var ln=((Microsoft.Research.CRNEngine.Distribution.LogNormal)d).LogNormal;
        Assert.Equal(2,Math.Exp(ln.mu+ln.sigma*ln.sigma/2),10);
        Assert.Equal(.5,(Math.Exp(ln.sigma*ln.sigma)-1)*Math.Exp(2*ln.mu+ln.sigma*ln.sigma),10);
    }
    [Fact]
    public void Fixed_links_can_pass_a_model_parameter_into_a_noise_only_fit()
    {
        var code=Systems+"\nnode calibration {systems=[low]}\nnode validation {systems=[high];inference={noise_parameter=Random}}\nedge calibration -> [k=Fixed] validation";
        var model=Run(code,[Data("low",10),Data("high",20)],"validation");
        Assert.False(model.Inference!.Priors!.Single(p=>p.Name=="k").Variable);
        Assert.All(model.Inference.Parameters,p=>Assert.Equal("noise",p.Kind));
        Assert.Equal(model.InferenceNodes![0].Inference.Parameters.Single(p=>p.Name=="k").Mle,model.Inference.Priors!.Single(p=>p.Name=="k").Initial);
    }

    [Fact]
    public void Named_simulations_without_explicit_sweeps_keep_both_observation_instances()
    {
        var model=Run(Standalone.Replace("directive data [dose]","directive data [dose]\ndirective simulations [one={plots=[A]};two={plots=[A]}]") ,[Data("dose",10)]);
        Assert.Equal(2,model.Simulations.Length);Assert.Equal(10,model.Inference!.DataPoints);
        Assert.Equal(new[]{"one","two"},model.Simulations.Select(r=>r.Name));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Multiple_parameters_and_partial_likelihoods_fit_each_sweep_instance(bool partial)
    {
        var first=Data("dose",10).Tables[0];
        var second=Data("dose",20).Tables[0] with {Series=[new("A",first.Times.Select(t=>20*Math.Exp(-.6*t)).ToArray())]};
        var data=new DatasetData("dose",[first,second]);
        string code=Standalone.Replace("variation=Random","variation=Multiple").Replace("[k=0.3,","[N=10;k=0.3,").Replace("| 10 A","| N A").Replace("directive data [dose]","directive data [dose]\ndirective sweeps [doses=[N=[10;20]]]").Replace("burnin=100;samples=120;thin=4",$"burnin=200;samples=400;thin=10;partial={partial.ToString().ToLowerInvariant()}");
        var model=Run(code,[data]);
        Assert.Equal(2,model.Inference!.Parameters.Count(p=>p.Kind=="model"));Assert.Equal(2,model.Simulations.Length);
        Assert.InRange(Math.Abs(model.Simulations[0].Series[0].Values[^1]-10*Math.Exp(-.7)),0,.15);
        Assert.InRange(Math.Abs(model.Simulations[1].Series[0].Values[^1]-20*Math.Exp(-1.2)),0,.15);
    }

    [Fact]
    public void Seed_override_cannot_silently_replace_a_list_of_chain_seeds()
    {
        var response=CoreEngine.Execute(new(){Code=Standalone,Language="crn",Operation="infer",Data=[Data("dose",10)],Seed=42});
        Assert.False(response.Success);Assert.Equal("INFERENCE_CHAINS",Assert.Single(response.Diagnostics).Code);
    }

    [Fact]
    public void Joint_fit_observations_preserve_each_systems_own_time_unit()
    {
        var low=Data("low",10);low.Tables[0]=low.Tables[0] with {TimeUnit="min"};
        var model=Run(Systems.Replace("system low = {","system low = { directive units {time=min}"),[low,Data("high",20)]);
        Assert.Equal(new[]{"min","s"},model.Inference!.Observations.Select(o=>o.TimeUnit));
        Assert.Equal(new[]{"min","s"},model.Simulations.Select(r=>r.Settings!.TimeUnit));
    }

}
