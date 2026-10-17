import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {splitRHat,histogram,correlation,posteriorCsv} from '../../src/VisualDsd.App/Web/posterior.js';
import {readResponse,serialiseProject,parseProject} from '../../src/VisualDsd.App/Web/project.js';
import {createDocument,requestFor,modelForNode,modelForRun} from '../../src/VisualDsd.App/Web/model.js';
globalThis.crypto??=webcrypto;

function fixture(){
  const doc=createDocument('fit.dsd','<a>');
  const p=(samples)=>({name:'k',kind:'model',mle:1.5,mean:samples.reduce((a,v)=>a+v,0)/samples.length,variance:.25,median:1.5,lower95:1,upper95:2,samples,splitRHat:null});
  const chains=[[1,2,1,2],[2,1,2,1]].map((samples,i)=>({seed:11+i,included:true,maxLogLikelihood:9-i,parameters:[p(samples)],logLikelihood:[5,6,7,8],iterations:[1,2,3,4],logPrior:[0,0,0,0]}));
  const all=p(chains.flatMap(c=>c.parameters[0].samples));all.splitRHat=splitRHat(chains.map(c=>c.parameters[0].samples));
  const settings={simulator:'oslo',initial:0,final:1,points:1,seed:null,timeUnit:'s',concentrationUnit:'nM'};
  const run={name:'',sweep:'',assignment:'',times:[0,1],series:[{name:'a',values:[2,1]}],seed:null,settings};
  const fit={seed:11,burnIn:0,iterations:4,thin:1,retainedSamples:8,dataPoints:2,maxLogLikelihood:9,parameters:[all],logLikelihood:chains.flatMap(c=>c.logLikelihood),observations:[{times:[0,1],series:[{name:'a',values:[2,1]}]}],chains,lowerBound:null,priors:[{name:'k',initial:1.5,distribution:'Uniform(1,2)',interval:'Real',variable:true}]};
  const response={success:true,operation:'infer',dialect:'current',diagnostics:[],model:{kind:'classic',compilation:'default',isJit:false,settings,species:[{id:'a',name:'a',structure:'<a>',svg:'',initial:'2',constant:false,time:null,valueKind:'initial'}],reactions:[],simulations:[run],inference:fit}};
  doc.data=[{name:'observed',tables:fit.observations}];
  const view={response,snapshot:{name:doc.name,request:requestFor(doc,'infer'),engineVersion:'0.13.0'},tab:'fit',runIndex:0,fitParameter:'k'};
  return{doc,view,response,fit};
}

test('classical split R-hat matches an independently computed variance ratio',()=>{
  const c=[[1,2,3,4,5,6,7,8],[2,3,4,5,6,7,8,9]];
  // Half means: 2.5,6.5,3.5,7.5; W=5/3, B=68/3, N=4.
  assert.ok(Math.abs(splitRHat(c)-Math.sqrt((.75*(5/3)+(68/3)/4)/(5/3)))<1e-12);
  assert.equal(splitRHat([[1,2,3,4]]),null);
  assert.equal(splitRHat([[1,1,1,1],[2,2,2,2]]),null);
  assert.equal(splitRHat([[1,2,3],[2,3,4]]),null);
});

test('marginal histogram conserves all draws and integrates to one including constant samples',()=>{
  for(const samples of [[1,2,3,4,5,6],[2,2,2,2]]){
    const bins=histogram(samples);assert.equal(bins.reduce((a,b)=>a+b.count,0),samples.length);
    assert.ok(Math.abs(bins.reduce((a,b)=>a+b.density*(b.high-b.low),0)-1)<1e-12);
  }
  assert.equal(correlation([1,2,3],[2,4,6]),1);assert.equal(correlation([1,1],[1,2]),null);
});

test('posterior CSV retains seeds, inclusion, exact iterations, log priors and every chain sample',()=>{
  const {fit}=fixture();fit.chains[1].included=false;
  const rows=posteriorCsv(fit).trim().split('\r\n');
  assert.equal(rows.length,9);assert.match(rows[0],/Recorded iteration,Chain seed,Included in pooled posterior,logLikelihood,logPrior,k/);
  assert.equal(rows[1],'1,11,1,5,0,1');assert.equal(rows[5],'1,12,0,5,0,2');
});

test('multi-chain project roundtrip preserves chain boundaries, priors and diagnostic values',()=>{
  const {doc,view,response}=fixture();
  const restored=parseProject(serialiseProject([doc],doc.id,new Map([[doc.id,view]]),'0.13.0')).views.get(doc.id);
  assert.deepEqual(restored.response,response);assert.equal(restored.fitParameter,'k');
});

test('malformed chain selections, pooled draws, diagnostics and priors are rejected transactionally',()=>{
  for(const mutate of [
    f=>f.chains[1].seed=11,f=>f.chains[0].parameters[0].samples.pop(),f=>f.parameters[0].samples[0]=99,
    f=>f.chains[0].included=false,f=>f.chains[0].logPrior.pop(),f=>f.chains[0].iterations[0]=-1,
    f=>f.parameters[0].splitRHat=100,f=>f.logLikelihood[0]=100,f=>f.seed=999,f=>f.maxLogLikelihood=100,
    f=>f.priors.push({...f.priors[0]}),f=>f.lowerBound=100,
  ]){const{response,fit}=fixture();mutate(fit);assert.throws(()=>readResponse(response));}
});

function graphFixture(){
  const {doc,view,response}=fixture();doc.name='graph.crn';doc.options.language='crn';doc.code='model graph';
  const base=response.model,network={species:base.species,reactions:base.reactions};
  const first={nodeId:'first',settings:base.settings,network,simulations:structuredClone(base.simulations),inference:structuredClone(base.inference)};
  const second=structuredClone(first);second.nodeId='second';second.simulations[0].network={species:[{...base.species[0],id:'b',name:'b',structure:'<b>'}],reactions:[]};
  response.model={...base,kind:'crn',compilation:'source',crnCode:doc.code,program:{source:doc.code,nodes:['first','second'].map(id=>({id,systems:[{id:'',speciesCount:1,reactionCount:0}]})),edges:[{source:{nodeId:'first',systemId:''},target:{nodeId:'second',systemId:''},parameters:[]}],selectedNodeId:'first',selectedSystemId:''},inferenceNodes:[first,second]};
  view.snapshot.request=requestFor(doc,'infer');view.fitNodeId='second';view.networkFocus='b';
  return{doc,view,response};
}

test('linked inference results and selected model, run and network survive project import',()=>{
  const{doc,view}=graphFixture();
  const restored=parseProject(serialiseProject([doc],doc.id,new Map([[doc.id,view]]),'0.13.0')).views.get(doc.id);
  assert.equal(restored.fitNodeId,'second');
  const selected=modelForRun(modelForNode(restored.response.model,restored.fitNodeId),restored.runIndex);
  assert.equal(selected.species[0].id,'b');assert.equal(restored.networkFocus,'b');
});

test('linked results cannot omit nodes, change the selected fit or invert dependency order',()=>{
  for(const mutate of [r=>r.model.inferenceNodes.pop(),r=>r.model.inferenceNodes.reverse(),r=>r.model.inferenceNodes[1].nodeId='unknown',r=>r.model.inferenceNodes[0].inference.parameters[0].mean=999]){
    const{response}=graphFixture();mutate(response);assert.throws(()=>readResponse(response));
  }
});
