import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {defaultLogicConfig,readout,logicPlots,caseRequest,newLogicBatch,readLogicState,logicIsCurrent,collectLogicMolecules} from '../../src/VisualDsd.App/Web/logic.js';
import {logicGraph,logicSignals,caseMetrics,batchMetrics,metricsCsv} from '../../src/VisualDsd.App/Web/logic-analysis.js';
import {createDocument,requestFor} from '../../src/VisualDsd.App/Web/model.js';
import {parseProject,serialiseProject} from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto??=webcrypto;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
function config(){return {...defaultLogicConfig(),inputs:[{name:'A',one:'<a>',zero:'',off:0,on:10}],outputs:[{name:'Y',one:'<y>',zero:'',expression:'A'}],low:2,high:8,time:10,final:10};}
const row=(times,values,expected=1,zero)=>({state:'succeeded',bits:[expected],expected:[expected],curve:{times,series:[{name:'<y>',values},...(zero?[{name:'<z>',values:zero}]:[])],timeUnit:'s',concentrationUnit:'nM'}});

test('linear ON response has an interpolated crossing, signed margin and no invented leakage',()=>{
  const c=config(),r=row([0,10],[0,10]),m=caseMetrics(c,r).outputs[0];
  assert.equal(m.leakage,null);assert.equal(m.margin,2);assert.deepEqual(m.response,{status:'reached',time:8,delay:8});
  c.time=5;const earlier=caseMetrics(c,r,{start:0,end:10}).outputs[0];assert.equal(earlier.margin,-3);assert.equal(readout(c,r).status,'unknown');assert.equal(earlier.response.time,8);
});
test('OFF leakage includes window boundaries and response delay is relative to its start',()=>{
  const c=config(),r=row([0,10],[10,0],0),m=caseMetrics(c,r,{start:5,end:9}).outputs[0];
  assert.deepEqual(m.leakage,{structure:'<y>',value:5,time:5});assert.equal(m.margin,2);assert.deepEqual(m.response,{status:'reached',time:8,delay:3});
});
test('sustained response uses the final crossing after a transient, not the first hit',()=>{
  const m=caseMetrics(config(),row([0,3,6,10],[0,10,0,10])).outputs[0];close(m.response.time,9.2);close(m.response.delay,9.2);
  const drop=caseMetrics(config(),row([0,4,6,10],[0,10,10,0])).outputs[0];assert.deepEqual(drop.response,{status:'notReached',time:null,delay:null});
});
test('a narrow recorded leakage peak survives window clipping and threshold interpolation',()=>{
  const m=caseMetrics(config(),row([0,3,4,5,10],[0,0,100,0,0],0),{start:3.5,end:6}).outputs[0];assert.equal(m.leakage.value,100);assert.equal(m.leakage.time,4);close(m.response.time,4.98);close(m.response.delay,1.48);
});
test('already valid outputs have zero delay; threshold equality remains valid',()=>{
  const c=config();assert.deepEqual(caseMetrics(c,row([0,10],[0,1],0)).outputs[0].response,{status:'atStart',time:0,delay:0});
  const m=caseMetrics(c,row([0,10],[0,8])).outputs[0];assert.equal(m.margin,0);assert.deepEqual(m.response,{status:'reached',time:10,delay:10});
  assert.equal(caseMetrics(c,row([0,10],[8,8])).outputs[0].response.status,'atStart');
});
test('dual-rail response waits for both the required ON rail and the complementary OFF rail',()=>{
  const c=config();c.outputs[0].zero='<z>';
  const m=caseMetrics(c,row([0,8,10],[0,10,10],1,[10,5,0])).outputs[0];close(m.response.time,9.2);assert.equal(m.margin,2);assert.equal(m.leakage.structure,'<z>');assert.equal(m.leakage.value,10);
  const opposite=caseMetrics(c,row([0,10],[0,10],0,[10,0])).outputs[0];assert.equal(opposite.margin,-8);assert.equal(opposite.leakage.structure,'<y>');assert.equal(opposite.response.status,'notReached');
  for(const [a,b]of [[10,10],[0,0],[5,1]]){const m=caseMetrics(c,row([0,10],[0,a],1,[0,b])).outputs[0];assert.ok(m.margin<0);assert.equal(m.response.status,'notReached');}
});
test('duplicate timestamps preserve the last sample for readout and the final valid interval',()=>{
  const c=config();c.time=5;const m=caseMetrics(c,row([0,5,5,10],[0,10,0,10]),{start:0,end:10}).outputs[0];assert.equal(m.margin,-8);close(m.response.time,9);
});
test('large finite samples do not overflow an interpolated crossing or clipped window',()=>{
  const m=caseMetrics(config(),row([0,10],[-1e308,1e308]),{start:1,end:10}).outputs[0];close(m.response.time,5);close(m.response.delay,4);assert.ok(Number.isFinite(m.margin));
});
test('execution failures are not zero-valued metrics and incomplete windows never extrapolate',()=>{
  const c=config();for(const state of ['failed','timedOut','cancelled','interrupted','queued'])assert.deepEqual(caseMetrics(c,{state}),{state,outputs:[]});
  assert.equal(caseMetrics(c,row([2,10],[0,10])).state,'unavailable');
  for(const edit of [r=>r.curve.series[0].values[1]=Infinity,r=>r.curve.times.reverse(),r=>r.curve.concentrationUnit='M',r=>r.curve.series[0].name='<missing>']){const r=row([0,10],[0,10]);edit(r);assert.equal(caseMetrics(c,r).state,'unavailable');}
  assert.throws(()=>caseMetrics(c,row([0,10],[0,10]),{start:5,end:4}));assert.throws(()=>caseMetrics(c,row([0,10],[0,10]),{start:0,end:11}));
});
test('summary excludes unavailable cases and counts not-reached responses explicitly',()=>{
  const b={config:config(),cases:[row([0,10],[0,1],0),row([0,10],[0,3],0),row([0,10],[0,10],1),{state:'timedOut'}]};const s=batchMetrics(b);assert.equal(s.available,3);assert.equal(s.total,4);assert.equal(s.outputs[0].maximumLeakage.leakage.value,3);assert.equal(s.outputs[0].minimumMargin.margin,-1);assert.equal(s.outputs[0].maximumResponse.response.delay,8);assert.equal(s.outputs[0].notReached,1);
});
test('expected Boolean diagram shares gates, preserves roles and evaluates each case',()=>{
  const c=config();c.inputs.push({name:'B',one:'<b>',zero:'',off:0,on:10});c.outputs[0].expression='(A AND B) OR (A AND B)';
  const g=logicGraph(c,[1,0]);assert.equal(g.nodes.filter(n=>n.kind==='and').length,1);assert.equal(g.nodes.find(n=>n.key==='outputs:Y').value,0);assert.equal(new Set(g.nodes.map(n=>n.key)).size,g.nodes.length);
  assert.ok(g.edges.every(e=>g.nodes.some(n=>n.key===e.source)&&g.nodes.some(n=>n.key===e.target)));
  assert.ok(g.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.x>=0&&n.y>=0));
  assert.equal(logicGraph(c,[1,1]).nodes.find(n=>n.key==='outputs:Y').value,1);
  c.outputs.push({name:'A',one:'<other>',zero:'',expression:'NOT A XOR 1'});const roles=logicGraph(c,[0,1]).nodes;assert.ok(roles.some(n=>n.key==='inputs:A'));assert.ok(roles.some(n=>n.key==='outputs:A'));assert.equal(logicSignals(c).length,4);
  assert.throws(()=>logicGraph(c,[2,0]));
});
test('recording input traces deduplicates shared molecules and supports all sixteen physical rails',()=>{
  const c=config();c.outputs[0].one='<a>';assert.deepEqual(logicPlots(c,true),['<a>']);
  c.inputs=Array.from({length:4},(_,i)=>({name:`A${i}`,one:`<a${i}>`,zero:`<na${i}>`,off:0,on:10}));c.outputs=Array.from({length:4},(_,i)=>({name:`Y${i}`,one:`<y${i}>`,zero:`<ny${i}>`,expression:`A${i}`}));
  const request=caseRequest({code:'original'},c,[0,1,0,1],{traceInputs:true});assert.equal(request.logicCase.outputs.length,16);assert.equal(request.logicCase.inputs.length,8);assert.equal(request.code,'original');assert.equal(request.logicCase.inputs[2].value,10);
});
test('new and old experiments roundtrip; analysis windows do not invalidate or rewrite simulation provenance',()=>{
  const model=createDocument('logic.dsd','<a>'),c=config(),base=requestFor(model,'simulate'),b=newLogicBatch(base,c,'0.23.0',{traceInputs:true});
  b.cases[0]={...b.cases[0],...row([0,10],[0,1],0)};b.cases[0].curve.series.push({name:'<a>',values:[0,0]});
  b.molecules=collectLogicMolecules({model:{species:[{name:'y',structure:'<y>',svg:'<svg xmlns="http://www.w3.org/2000/svg"/>'},{name:'a',structure:'<a>',svg:''}],simulations:[]}},{logicCase:{outputs:logicPlots(c,true)}});
  b.analysis={start:2,end:9};model.logic={version:1,config:c,batch:b};
  const restored=parseProject(serialiseProject([model],model.id,new Map(),'0.23.0')).documents[0].logic;assert.deepEqual(restored,model.logic);assert.equal(logicIsCurrent(base,c,b),true);assert.equal(b.request.code,'<a>');
  const legacy=structuredClone(model.logic);delete legacy.batch.traceInputs;delete legacy.batch.molecules;delete legacy.batch.analysis;legacy.batch.cases[0].curve.series.pop();assert.equal(readLogicState(legacy).batch.cases[0].curve.series.length,1);
  for(const edit of [b=>b.analysis.end=11,b=>b.analysis.start=-1,b=>b.traceInputs='yes',b=>b.molecules[0].structure='<wrong>',b=>b.molecules.push(b.molecules[0]),b=>b.cases[0].curve.series.pop()]){const data=structuredClone(model.logic);edit(data.batch);assert.throws(()=>readLogicState(data));}
});
test('metrics CSV includes units, window, expected state, unavailable values and precise crossing times',()=>{
  const c=config(),b={id:'test',engineVersion:'0.23.0',config:c,cases:[row([0,3,6,10],[0,10,0,10]),{state:'timedOut',bits:[0],expected:[0],message:'limit reached'}]};const csv=metricsCsv(b);assert.match(csv,/Leakage peak/);assert.match(csv,/Threshold margin/);assert.match(csv,/Window start/);assert.match(csv,/9.2/);assert.match(csv,/not|timedOut/);assert.match(csv,/nM/);assert.match(csv,/limit reached/);
});
