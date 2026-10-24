import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {systemsLessons,systemSource,termExercises} from '../../src/VisualDsd.App/Web/systems-lessons.js';
import {emptySystemsWorkspace,readSystemsWorkspace,newSystemsStudy,readSystemsPlan,collectSystemsCurve,systemSample,systemStats,systemsSummary,systemsInvariant,systemsComparison,systemsCsv} from '../../src/VisualDsd.App/Web/systems.js';
import {systemsExerciseFiles,systemsReport,termExerciseFiles,termWorkbook} from '../../src/VisualDsd.App/Web/systems-export.js';
import {zipFiles} from '../../src/VisualDsd.App/Web/course-export.js';
import {createDocument} from '../../src/VisualDsd.App/Web/model.js';
import {serialiseProject,parseProject} from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto??=webcrypto;
const copy=x=>structuredClone(x);
function fixture(){
  const state=emptySystemsWorkspace();state.plan={repeats:3,seed:41};state.study=newSystemsStudy('conversion',state.plan,'0.28.0');
  for(const [i,row] of state.study.runs.entries()){
    row.state='succeeded';row.jobId=String(i+1).padStart(32,'0');row.engineVersion='0.28.0';
    const last=i===0?.1:i;row.curve={times:[0,10,20],series:[{name:'A',values:[20,5,last]},{name:'B',values:[0,15,20-last]}],timeUnit:'s',concentrationUnit:'nM'};
  }return state;
}
test('systems lessons define independent CRNs, paired condition seeds and bounded explicit budgets',()=>{
  assert.equal(termExercises.length,11);assert.equal(systemsLessons.length,3);
  for(const lesson of systemsLessons){const study=newSystemsStudy(lesson.id,{repeats:12,seed:2147483636},'1.2.3');assert.equal(study.runs.length,lesson.conditions.length*13);for(const c of lesson.conditions){const runs=study.runs.filter(r=>r.conditionId===c.id);assert.equal(runs[0].simulator,'oslo');assert.equal(runs[0].seed,null);assert.deepEqual(runs.slice(1).map(r=>r.seed),Array.from({length:12},(_,i)=>2147483636+i));assert.equal(runs[0].request.code,systemSource(lesson.id,c.id));assert.match(runs[0].request.code,/scale=1; trajectories=1/);}}
  for(const plan of [{repeats:1,seed:0},{repeats:13,seed:0},{repeats:3.5,seed:0},{repeats:3,seed:-1},{repeats:3,seed:2147483637}])assert.throws(()=>readSystemsPlan(plan));
});
test('systems snapshots preserve original values, notes, failed runs and immutable request provenance',()=>{
  const state=fixture();state.notes.interpretation='My observation, not generated';state.study.runs[2]={...state.study.runs[2],state:'failed',message:'solver failure'};delete state.study.runs[2].curve;
  assert.deepEqual(readSystemsWorkspace(JSON.parse(JSON.stringify(state))),state);
  const reordered=copy(state);reordered.study.runs[0].request=Object.fromEntries(Object.entries(reordered.study.runs[0].request).reverse());assert.deepEqual(readSystemsWorkspace(reordered),state);
  for(const mutate of [s=>s.study.runs[1].seed++,s=>s.study.runs[1].request.code+='\n',s=>s.study.runs[1].request.simulator='oslo',s=>s.study.runs[1].engineVersion='other',s=>s.study.runs[1].curve.times.pop(),s=>s.study.runs[1].curve.series[0].values[1]=1.5,s=>s.study.runs[1].jobId=s.study.runs[0].jobId,s=>s.study.runs[1].curve.concentrationUnit='copies',s=>s.study.runs[1].state='queued',s=>s.study.runs.reverse(),s=>s.study.runs[1].curve.times[2]=19]){const invalid=copy(state);mutate(invalid);assert.throws(()=>readSystemsWorkspace(invalid));}
  const pending=emptySystemsWorkspace();pending.study=newSystemsStudy('conversion',pending.plan,'0.28.0');pending.study.runs[0].state='admitting';assert.equal(readSystemsWorkspace(pending).study.runs[0].state,'admitting');
});
test('SSA samples are right-continuous and never linearly invent populations',()=>{
  const curve={times:[0,2,2,5],series:[{name:'A',values:[8,7,6,5]}]};
  assert.equal(systemSample(curve,'A',1),8);assert.equal(systemSample(curve,'A',2),6);assert.equal(systemSample(curve,'A',4.99),6);assert.equal(systemSample(curve,'A',5),5);assert.equal(systemSample(curve,'A',1,'oslo'),7.5);assert.throws(()=>systemSample(curve,'A',6));
  const state=fixture();state.study.runs[1].curve.times[2]=19.9999999;const saved=readSystemsWorkspace(state);assert.equal(saved.study.runs[1].curve.times[2],19.9999999);assert.equal(systemSample(saved.study.runs[1].curve,'A',20),1);
});
test('ensemble statistics exclude unavailable runs and distinguish SD from uncertainty of the mean',()=>{
  const study=fixture().study;study.runs[3].state='cancelled';delete study.runs[3].curve;
  const summary=systemsSummary(study,'A')[0];assert.equal(summary.requested,3);assert.equal(summary.unavailable,1);assert.equal(summary.n,2);assert.equal(summary.mean,1.5);assert.equal(summary.sd,Math.sqrt(.5));assert.equal(summary.cv,Math.sqrt(.5)/1.5);assert.ok(Math.abs(summary.fano-1/3)<1e-14);assert.equal(summary.deterministic,.1);
  const stats=systemStats([0,0]);assert.equal(stats.sd,0);assert.equal(stats.cv,null);assert.equal(stats.fano,null);assert.equal(systemStats([7]).sd,null);assert.equal(systemStats([]).mean,null);assert.throws(()=>systemStats([Infinity]));
  study.runs.forEach(r=>{r.state='interrupted';delete r.curve;});assert.equal(systemsSummary(study,'A')[0].mean,null);assert.equal(systemsSummary(study,'A')[0].unavailable,3);
});
test('comparison plots and conservation checks use only retained data and the selected condition',()=>{
  const study=fixture().study;assert.equal(systemsInvariant(study.runs[1],'conversion').maxAbsoluteError,0);
  const plot=systemsComparison(study,'baseline','A');assert.equal(plot.series.length,2);assert.equal(plot.series[1].values.at(-1),2);assert.equal(plot.series[1].standardDeviation.at(-1),1);
  const individual=systemsComparison(study,'baseline',{species:'A',seed:42},'individual');assert.equal(individual.mode,'step');assert.equal(individual.series[1].values.at(-1),2);assert.equal(systemsComparison(study,'baseline',{species:'A',seed:100},'individual').times.length,0);
});
test('collecting results verifies actual simulator, settings, seed and selected CRN',()=>{
  const state=fixture(),row=state.study.runs[1],settings={simulator:'ssa',initial:0,final:20,points:150,seed:41,timeUnit:'s',concentrationUnit:'nM'};
  const response={success:true,operation:'simulate',model:{kind:'crn',settings,simulations:[{...row.curve,seed:41}]}};
  assert.deepEqual(collectSystemsCurve(response,row,'conversion'),row.curve);
  for(const change of [r=>r.model.settings.seed++,r=>r.model.settings.simulator='lna',r=>r.model.simulations.push(copy(r.model.simulations[0])),r=>r.success=false]){const invalid=copy(response);change(invalid);assert.throws(()=>collectSystemsCurve(invalid,row,'conversion'));}
});
test('new project field remains optional and systems studies round-trip independently of model drafts',()=>{
  const doc=createDocument(),state=fixture();const json=serialiseProject([doc],doc.id,new Map(),'0.28.0',undefined,state);
  assert.deepEqual(parseProject(json).systems,state);assert.deepEqual(parseProject(serialiseProject([doc],doc.id,new Map(),'0.28.0')).systems,emptySystemsWorkspace());
  const bad=JSON.parse(json);bad.systems.study.runs[0].request.final=30;assert.throws(()=>parseProject(JSON.stringify(bad)));
});
test('bilingual course and lab exports retain real data and escape student text',()=>{
  const state=fixture();state.notes.hypothesis='<script>alert(1)</script>';const report=systemsReport(state,{language:'en'});assert.match(report,/&lt;script&gt;/);assert.doesNotMatch(report,/<script>/);assert.match(report,/not a confidence interval|neither confidence intervals/);assert.match(systemsReport(state,{language:'fa'}),/dir="rtl"/);
  const files=systemsExerciseFiles(state);assert.deepEqual(JSON.parse(files.find(f=>f.name==='systems.json').data),state);assert.match(systemsCsv(state.study),/"41"/);assert.match(systemsCsv(state.study),/"0.1"/);assert.ok(zipFiles(files).length>1000);
  const pack=termExerciseFiles('2026-10-24T00:00:00Z');assert.equal(new Set(pack.map(f=>f.name)).size,pack.length);assert.equal(JSON.parse(pack.find(f=>f.name==='manifest.json').data).exercises.length,11);assert.equal(pack.filter(f=>f.name.endsWith('.crn')).length,4);assert.match(termWorkbook('en'),/RNA-seq/);assert.match(termWorkbook('fa'),/dir="rtl"/);assert.ok(zipFiles(pack).length>10000);
});
