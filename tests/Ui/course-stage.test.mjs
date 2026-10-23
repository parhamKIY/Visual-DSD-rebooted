import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,requestFor,restoreWorkspace} from '../../src/VisualDsd.App/Web/model.js';
import {readLogicState,readStudyPlan,defaultStudyPlan,caseRequest,sampleAt,readLogicCase,readLogicReport} from '../../src/VisualDsd.App/Web/logic.js';
import {caseMetrics} from '../../src/VisualDsd.App/Web/logic-analysis.js';
import {newStudy,statistics,studySummary,studyCsv,studyIsCurrent,studyRows} from '../../src/VisualDsd.App/Web/logic-study.js';
import {logicReport,logicExerciseFiles,workspaceReport,workspaceExerciseFiles,zipFiles,crc32,curveSvg,curveCsv} from '../../src/VisualDsd.App/Web/course-export.js';
import {defaultAdleman,readAdleman,adlemanStages,adlemanGraphSvg,adlemanReport,adlemanPackage} from '../../src/VisualDsd.App/Web/adleman.js';
import {serialiseProject,parseProject,normaliseRequest} from '../../src/VisualDsd.App/Web/project.js';

function fixture(){
  const model=createDocument('decay.crn','directive parameters [k=1]\n0 A | A ->{k} B'),base=requestFor(model,'simulate');
  const config={title:'Teaching comparison',provenance:'test',inputs:[{name:'A',one:'A',zero:'',off:0,on:10}],outputs:[{name:'Y',one:'B',zero:'',expression:'A'}],low:2,high:8,time:2,final:2,points:2,timeout:10,unit:'nM',timeUnit:'s'};
  const plan={...defaultStudyPlan(),simulator:'ssa',repeats:2,variants:[{label:'Reference',onFactor:1,offFactor:1,parameters:[]},{label:'Slower',onFactor:1,offFactor:1,parameters:[{name:'k',value:.5}]}]},study=newStudy(base,config,plan,'0.24.0');
  for(const batch of study.batches)for(const row of batch.cases){row.state='succeeded';row.jobId='a'.repeat(32);row.curve={times:[0,1,2],series:[{name:'B',values:row.bits[0]?[0,5,10]:[0,0,0]},{name:'A',values:row.bits[0]?[10,5,0]:[0,0,0]}],timeUnit:'s',concentrationUnit:'nM',mode:'step'};}
  model.logic={version:1,config,studyPlan:plan,study};return {model,base,config,plan,study};
}
test('comparison requests preserve source, assign paired repeat seeds and keep physical concentrations explicit',()=>{
  const {base,config,plan,study}=fixture();assert.equal(study.batches.length,4);assert.equal(studyRows(study).length,8);
  assert.equal(study.batches[0].execution.seed,plan.seed);assert.equal(study.batches[1].execution.seed,plan.seed+16);assert.equal(study.batches[2].execution.seed,plan.seed);
  const request=caseRequest(base,config,[1],{traceInputs:true,execution:study.batches[2].execution});assert.equal(request.seed,plan.seed+1);assert.equal(request.code,base.code);assert.equal(request.simulator,'ssa');assert.deepEqual(request.logicCase.parameters,[{name:'k',value:.5}]);assert.equal(request.logicCase.inputs[0].value,10);assert.deepEqual(normaliseRequest(request),request);
  assert.equal(studyIsCurrent(base,config,plan,study),true);assert.equal(studyIsCurrent({...base,code:'changed'},config,plan,study),false);
});
test('plan bounds reject excess runs, invalid seeds, negative/fractional repeats, overflow and duplicate variants/parameters',()=>{
  const {config,plan}=fixture();for(const edit of [p=>p.seed=-1,p=>p.seed=2147483520,p=>p.repeats=1.5,p=>p.repeats=9,p=>p.simulator='arbitrary',p=>p.variants[1].label=p.variants[0].label,p=>p.variants[1].onFactor=0,p=>p.variants[1].offFactor=-1,p=>p.variants[1].parameters.push({name:'k',value:2}),p=>p.variants[0].onFactor=Number.MAX_VALUE]){const p=structuredClone(plan);edit(p);assert.throws(()=>readStudyPlan(p,config));}
  const large={...config,inputs:Array.from({length:4},(_,i)=>({name:`A${i}`,one:`a${i}`,zero:'',off:0,on:10})),outputs:[{...config.outputs[0],expression:'A0'}]};assert.throws(()=>readStudyPlan({...plan,repeats:3},large),/64/);
  assert.throws(()=>readStudyPlan({...plan,simulator:'oslo'},config),/one deterministic/);assert.throws(()=>readLogicCase({inputs:[{structure:'A',value:1}],outputs:['B'],parameters:[{name:'x);alert(1)',value:1}]}));
});
test('stochastic readout holds the last returned sample and response waits for the sampled jump',()=>{
  const {config,study}=fixture(),row=study.batches[0].cases[1];assert.deepEqual(sampleAt(row.curve,1.9),[5,5]);const metrics=caseMetrics(config,row);assert.equal(metrics.outputs[0].response.time,2);assert.equal(metrics.outputs[0].margin,2);
  const linear=structuredClone(row);delete linear.curve.mode;assert.ok(Math.abs(caseMetrics(config,linear).outputs[0].response.time-1.6)<1e-12);
  assert.match(curveSvg(row.curve),/H[\d.]+V[\d.]+/);assert.match(curveCsv(row.curve),/Time \(s\)/);
});
test('summary separates uncertainty, missing execution and not-reached delay without creating zeros',()=>{
  const {study}=fixture();study.batches[0].cases[1].state='timedOut';delete study.batches[0].cases[1].curve;study.batches[1].cases[1].curve.series[0].values=[0,3,5];
  const summary=studySummary(study).find(s=>s.variant==='Reference'&&s.caseIndex===1);assert.deepEqual(summary.counts,{correct:0,incorrect:0,unknown:1,unavailable:1,notReached:1});assert.equal(summary.concentration.n,1);assert.equal(summary.concentration.mean,5);assert.equal(summary.concentration.sd,null);assert.equal(summary.response.n,0);assert.equal(summary.response.mean,null);
  const csv=studyCsv(study);for(const term of ['Seed','Simulator','Parameters','Job','timedOut','unknown','1235'])assert.ok(csv.includes(term),term);
});
test('sample statistics have n-1 SD and no fabricated uncertainty for one value',()=>{
  assert.equal(statistics([5]).sd,null);assert.equal(statistics([]).mean,null);const s=statistics([1,3]);assert.equal(s.mean,2);assert.ok(Math.abs(s.sd-Math.sqrt(2))<1e-12);assert.equal(statistics([Number.MAX_VALUE,Number.MAX_VALUE]).mean,Number.MAX_VALUE);assert.throws(()=>statistics([NaN]));
});

test('student notes reject non-object payloads and retain a blank interpretation',()=>{
  for(const raw of [null,[],5,'notes'])assert.throws(()=>readLogicReport(raw));
  assert.deepEqual(readLogicReport({}),{student:'',question:'',interpretation:'',limitations:''});
  const {model}=fixture();model.logic.study.batches[0].execution=null;assert.throws(()=>readLogicState(model.logic));
});
test('projects and browser storage retain comparisons, exact plans and student interpretation',()=>{
  const {model,study}=fixture();model.courseReport={student:'Student',question:'Question',interpretation:'My interpretation',limitations:'Sampling'};const raw=serialiseProject([model],model.id,new Map(),'0.24.0'),round= parseProject(raw).documents[0];assert.deepEqual(round.logic.study,study);assert.deepEqual(round.courseReport,model.courseReport);assert.equal(restoreWorkspace(JSON.stringify({version:1,documents:[model],activeId:model.id})).documents[0].logic.study.batches.length,4);
  for(const edit of [s=>s.batches.pop(),s=>s.batches[0].execution.seed++,s=>s.batches[0].request.code='changed',s=>s.batches[0].config.high=9,s=>s.batches[0].cases[1].curve.mode='linear',s=>s.batches[0].engineVersion='other']){const copy=structuredClone(model.logic);edit(copy.study);assert.throws(()=>readLogicState(copy));}
});
test('printable report escapes student/source content, distinguishes failed cases and includes recorded settings',()=>{
  const {model}=fixture();const logic={...model.logic,report:{student:'<img src=x onerror=alert(1)>',question:'<script>bad</script>',interpretation:'My conclusion',limitations:'Grid'}},report=logicReport(logic,{createdAt:'2026-10-23T00:00:00Z',currentSource:'changed'});assert.ok(!report.includes('<script>'));assert.match(report,/&lt;script&gt;/);assert.match(report,/Earlier source snapshot/);for(const key of ['0.24.0','1234','Slower','My conclusion','Sample SD','not biological','@media print'])assert.ok(report.includes(key),key);assert.match(logicReport(logic,{language:'fa'}),/dir="rtl"/);
  const project=serialiseProject([model],model.id,new Map(),'0.24.0'),files=logicExerciseFiles(logic,project,{createdAt:'2026-10-23T00:00:00Z'});assert.equal(new Set(files.map(f=>f.name)).size,files.length);assert.ok(files.some(f=>f.name.endsWith('data.csv')));assert.equal(files.find(f=>f.name==='comparison/variant-1/repeat-2/source.crn').data,model.code);assert.equal(parseProject(files.find(f=>f.name==='project.dsdproj.json').data).documents[0].logic.study.batches.length,4);assert.ok(zipFiles(files).length>1000);
});
test('workspace report keeps an earlier completed source and explicitly labels an absent calculation',()=>{
  const {model}=fixture();assert.match(workspaceReport(model,null),/No completed calculation/);const view={snapshot:{request:{code:'old source'},engineVersion:'0.24.0'},response:{success:true,operation:'simulate',dialect:'current',model:{species:[],reactions:[],simulations:[],settings:{}}}};assert.match(workspaceReport(model,view),/earlier source snapshot/);const files=workspaceExerciseFiles(model,view,'project');assert.equal(files.find(f=>f.name==='source.crn').data,'old source');assert.ok(files.some(f=>f.name==='result.json'));
});
test('ZIP payload has standard CRC32, deterministic output and rejects traversal, duplicate and oversized data',()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);assert.deepEqual(zipFiles([{name:'a.txt',data:'text'}]),zipFiles([{name:'a.txt',data:'text'}]));for(const name of ['../x','/x','a/../x','a//x','a/./x','bad\\x'])assert.throws(()=>zipFiles([{name,data:'x'}]));assert.throws(()=>zipFiles([{name:'a',data:'x'},{name:'a',data:'y'}]));assert.throws(()=>zipFiles([{name:'big',data:new Uint8Array(64*1024*1024+1)}]));
});
test('Adleman filters enumerate exactly the Hamiltonian paths and do not silently truncate',()=>{
  const state=defaultAdleman(),stages=adlemanStages(state);assert.equal(stages.length,state.graph.vertices.length+3);for(let i=1;i<stages.length;i++)assert.ok(stages[i].paths.length<=stages[i-1].paths.length);assert.ok(stages.at(-1).paths.length>0);
  const brute=[];const permute=path=>{if(path.length===state.graph.vertices.length){if(path[0]===state.graph.start&&path.at(-1)===state.graph.end&&path.slice(1).every((v,i)=>state.graph.edges.some(e=>e[0]===path[i]&&e[1]===v)))brute.push(path);return;}for(const v of state.graph.vertices)if(!path.includes(v))permute([...path,v]);};permute([]);assert.deepEqual(stages.at(-1).paths.map(p=>p.join(',')).sort(),brute.map(p=>p.join(',')).sort());assert.throws(()=>adlemanStages(state,3),/Candidate pool/);
  const none=structuredClone(state);none.graph.edges=[];assert.equal(adlemanStages(none).at(-1).paths.length,0);assert.match(adlemanReport(none),/enumeration was exhaustive/);
});
test('Adleman saves graph and interpretation, rejects malformed inputs and exports a self-contained package',()=>{
  const state=defaultAdleman();state.stage=state.graph.vertices.length+2;state.notes.interpretation='<script>student</script>';assert.deepEqual(readAdleman(JSON.parse(JSON.stringify(state))),state);const html=adlemanReport(state);assert.ok(!html.includes('<script>'));assert.match(html,/not the original experimental graph/);assert.match(html,/not reproduce the laboratory protocol/);assert.match(adlemanGraphSvg(state.graph),/<svg/);assert.ok(adlemanPackage(state).length>1000);
  for(const edit of [s=>s.graph.vertices.push('A'),s=>s.graph.vertices[0]='<script>',s=>s.graph.end=s.graph.start,s=>s.graph.edges.push(['missing','A']),s=>s.graph.edges.push(s.graph.edges[0]),s=>s.stage=99]){const copy=structuredClone(state);edit(copy);assert.throws(()=>readAdleman(copy));}
});
