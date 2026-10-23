import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import {booleanFunction,defaultLogicConfig,readLogicConfig,truthCases,caseRequest,sampleAt,readout,collectLogicCurve,readLogicState,newLogicBatch,logicIsCurrent,logicCsv} from '../../src/VisualDsd.App/Web/logic.js';
import {createDocument,requestFor,restoreWorkspace} from '../../src/VisualDsd.App/Web/model.js';
import {normaliseRequest,serialiseProject,parseProject} from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto??=webcrypto;
const example=JSON.parse(fs.readFileSync(new URL('../../src/VisualDsd.App/Web/logic-example.json',import.meta.url)));
const config=()=>structuredClone(example.logic.config);
function fixture(){
  const model=createDocument('Seesaw.vdsd',example.code,'legacy');model.logic={version:1,config:config()};
  const base=requestFor(model,'simulate'),b=model.logic.batch=newLogicBatch(base,model.logic.config,'0.22.0');
  b.cases[0].state='succeeded';b.cases[0].jobId='a'.repeat(32);b.cases[0].curve={times:[0,36000],series:[{name:b.config.outputs[0].one,values:[0,10]}],timeUnit:'s',concentrationUnit:'nM'};
  return {model,base,b};
}

test('Boolean grammar enumerates a three-level circuit with explicit precedence',()=>{
  const c=config(),rows=truthCases(c);
  assert.deepEqual(rows.map(r=>r.bits),[[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1]]);
  assert.deepEqual(rows.map(r=>r.expected[0]),[0,0,0,1,0,1,0,1]);
  const f=booleanFunction('NOT A AND B XOR C OR 0',['A','B','C']);assert.equal(f({A:0,B:1,C:1}),0);assert.equal(f({A:0,B:1,C:0}),1);
  assert.equal(booleanFunction('!(A & B) | C',['A','B','C'])({A:1,B:1,C:0}),0);
});
test('Boolean expressions cannot execute code, silently omit tokens or exceed nesting bounds',()=>{
  for(const text of ['A; globalThis.x=1','Math.random()','A + B','A || B','A B','(A','Missing','10',''])assert.throws(()=>booleanFunction(text,['A','B']));
  assert.throws(()=>booleanFunction('!'.repeat(40)+'A',['A']));
  assert.throws(()=>booleanFunction('A | '.repeat(200)+'A',['A']));
});
test('at most four inputs enumerate exactly sixteen cases and mappings must be distinct',()=>{
  const c=config();c.inputs.push({name:'D',one:'<d>',zero:'',off:0,on:100});assert.equal(truthCases(c).length,16);
  c.inputs.push({name:'E',one:'<e>',zero:'',off:0,on:100});assert.throws(()=>truthCases(c));
  const duplicate=config();duplicate.inputs[1].one=duplicate.inputs[0].one;assert.throws(()=>truthCases(duplicate));
  assert.throws(()=>truthCases(defaultLogicConfig()),/map every/);
});
test('single and dual rails apply physical concentrations while preserving the exact source',()=>{
  const {base}=fixture(),c=config();c.inputs[0].zero='<A0>';
  const r=caseRequest(base,c,[0,1,0]);assert.equal(r.code,example.code);assert.equal(r.simulator,'oslo');
  assert.deepEqual(r.logicCase.inputs.slice(0,2),[{structure:c.inputs[0].one,value:10},{structure:'<A0>',value:90}]);
  assert.equal(r.logicCase.inputs[2].value,90);assert.deepEqual(normaliseRequest(r),r);
});
test('sampling interpolates and does not extrapolate or round threshold decisions',()=>{
  const curve={times:[0,2,2,4],series:[{values:[0,2,3,5]}]};
  assert.deepEqual(sampleAt(curve,1),[1]);assert.deepEqual(sampleAt(curve,2),[3]);assert.deepEqual(sampleAt(curve,3),[4]);
  assert.throws(()=>sampleAt(curve,-1));assert.throws(()=>sampleAt(curve,5));
  const c=config();c.time=1;c.low=20;c.high=80;
  const row=v=>({state:'succeeded',expected:[0],curve:{times:[0,1],series:[{values:[0,v]}]}});
  assert.equal(readout(c,row(20)).status,'correct');assert.equal(readout(c,row(80)).status,'incorrect');assert.equal(readout(c,row(79.999999)).status,'unknown');
});
test('both dual rails ON, OFF or intermediate remain unknown; execution failures are separate',()=>{
  const c=config();c.outputs[0].zero='<Y0>';c.time=1;
  const row=(a,b)=>({state:'succeeded',expected:[1],curve:{times:[0,1],series:[{values:[0,a]},{values:[0,b]}]}});
  for(const values of [[90,90],[10,10],[90,50],[50,10]])assert.equal(readout(c,row(...values)).status,'unknown');
  assert.equal(readout(c,row(90,10)).status,'correct');assert.equal(readout(c,row(10,90)).status,'incorrect');
  for(const state of ['failed','timedOut','cancelled','interrupted'])assert.deepEqual(readout(c,{state}),{status:state,outputs:[]});
});
test('all readout budgets, units, functions and concentrations are checked',()=>{
  for(const change of [c=>c.low=-1,c=>c.high=c.low,c=>c.time=0,c=>c.final=1,c=>c.points=501,c=>c.timeout=121,c=>c.inputs[0].on=-1,c=>c.inputs[0].off=NaN,c=>c.outputs[0].expression='BAD',c=>c.unit='',c=>c.inputs[0].name='AND']){const c=config();change(c);assert.throws(()=>truthCases(c));}
});
test('collecting a run resolves molecular structures rather than transient species names',()=>{
  const {base}=fixture(),c=config(),request=caseRequest(base,c,[0,0,0]),structure=c.outputs[0].one;
  const response={success:true,model:{settings:{timeUnit:'s',concentrationUnit:'nM'},species:[{id:'sp999',name:'sp999',structure}],simulations:[{times:[0,36000],series:[{name:'sp999',values:[0,10]}]}]}};
  const curve=collectLogicCurve(response,request,c);assert.equal(curve.series[0].name,structure);assert.equal(curve.series[0].values[1],10);
  const bad=structuredClone(response);bad.model.settings.concentrationUnit='M';assert.throws(()=>collectLogicCurve(bad,request,c),/units/);
  bad.model.settings.concentrationUnit='nM';bad.model.simulations[0].series[0].name='wrong';assert.throws(()=>collectLogicCurve(bad,request,c));
  bad.model.simulations.push(response.model.simulations[0]);assert.throws(()=>collectLogicCurve(bad,request,c));
});
test('experiment snapshots, results and pending jobs survive project and browser restoration',()=>{
  const {model,b}=fixture();b.cases[1].state='running';b.cases[1].jobId='b'.repeat(32);
  const restored=restoreWorkspace(JSON.stringify({version:1,documents:[model],activeId:model.id}));assert.deepEqual(restored.documents[0].logic,model.logic);
  const file=serialiseProject([model],model.id,new Map(),'0.22.0');const project=parseProject(file);assert.deepEqual(project.documents[0].logic,model.logic);
  assert.equal(logicIsCurrent(requestFor(model,'simulate'),model.logic.config,b),true);
  model.code+='\n';assert.equal(logicIsCurrent(requestFor(model,'simulate'),model.logic.config,b),false);
  model.code=example.code;model.logic.config.high++;assert.equal(logicIsCurrent(requestFor(model,'simulate'),model.logic.config,b),false);
});
test('corrupted truth-table values, units, trajectories and job identifiers cannot be imported',()=>{
  const {model}=fixture();
  for(const edit of [b=>b.cases.pop(),b=>b.cases[0].expected[0]=1,b=>b.cases[0].bits[0]=1,b=>b.cases[0].jobId='../job',b=>b.cases[0].curve=null,b=>b.cases[0].curve.times.reverse(),b=>b.cases[0].curve.series[0].values.pop(),b=>b.cases[0].curve.series[0].name='wrong',b=>b.cases[0].curve.concentrationUnit='M',b=>b.request.code=1,b=>b.createdAt='bad']){const raw=structuredClone(model.logic);edit(raw.batch);assert.throws(()=>readLogicState(raw));}
});
test('CSV contains observed and expected concentrations and explicit error states',()=>{
  const {b}=fixture();b.cases[1].state='timedOut';b.cases[1].message='timeout, "worker"';
  const csv=logicCsv(b);assert.match(csv,/Y expected/);assert.match(csv,/Y observed/);assert.match(csv,/nM/);assert.match(csv,/correct/);assert.match(csv,/timedOut/);assert.match(csv,/"timeout, ""worker"""/);
});
