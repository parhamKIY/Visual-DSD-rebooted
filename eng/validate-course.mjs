// Real packaged engine against analytic and independent SciPy reference curves.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {systemsLessons} from '../src/VisualDsd.App/Web/systems-lessons.js';
import {newSystemsStudy,collectSystemsCurve,readSystemsWorkspace,emptySystemsWorkspace,systemsInvariant,systemSample} from '../src/VisualDsd.App/Web/systems.js';
import {serialiseProject,parseProject} from '../src/VisualDsd.App/Web/project.js';
import {createDocument} from '../src/VisualDsd.App/Web/model.js';
globalThis.crypto??=webcrypto;
const root=fileURLToPath(new URL('../',import.meta.url)),app=resolve(process.argv[2]??resolve(root,'artifacts/publish/win-x64/VisualDsd.exe'));
const execute=(args,input)=>{const r=spawnSync(app,args,{input,encoding:'utf8',timeout:45000,maxBuffer:32*1024*1024,windowsHide:true});assert.ifError(r.error);assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
const version=execute(['--version']).trim(),reference=JSON.parse(await readFile(resolve(root,'tests/Ui/fixtures/systems-reference.json'),'utf8'));
const output=resolve(root,'artifacts/test-results/course');await mkdir(output,{recursive:true});
// Cubic interpolation of the dense independent reference, evaluated at actual
// adaptive Oslo samples. Never interpolate the tested solver to a coarser grid.
function referenceAt(expected,values,time){
  const times=expected.times,step=times[1]-times[0],first=Math.min(Math.max(0,Math.floor(time/step)-1),times.length-4);
  let sum=0;for(let j=first;j<first+4;j++){let term=values[j];for(let k=first;k<first+4;k++)if(k!==j)term*=(time-times[k])/(times[j]-times[k]);sum+=term;}return sum;
}
let runs=0,points=0;
for(const lesson of systemsLessons){
  const study=newSystemsStudy(lesson.id,{repeats:3,seed:42},version);
  for(const [index,row] of study.runs.entries()){
    const args=['simulate','-','--language','crn','--simulator',row.simulator,'--initial','0','--final',String(lesson.final),'--points','150','--timeout-seconds','30'];if(row.seed!=null)args.push('--seed',String(row.seed));
    const response=JSON.parse(execute(args,row.request.code));row.curve=collectSystemsCurve(response,row,lesson.id);row.state='succeeded';row.jobId=(index+1).toString(16).padStart(32,'0');row.engineVersion=version;runs++;
    const invariant=systemsInvariant(row,lesson.id);assert.ok(invariant.maxAbsoluteError<1e-7,`${lesson.id}: ${invariant.expression}`);
    if(row.simulator==='ssa'){
      for(const s of row.curve.series)assert.ok(s.values.every(v=>Number.isInteger(v)&&v>=0));
      // Run the actual solver again: reproducibility is checked, not assumed.
      if(row.repeat===1){const replay=collectSystemsCurve(JSON.parse(execute(args,row.request.code)),row,lesson.id);assert.deepEqual(replay,row.curve);runs++;}
    }else{
      const expected=reference.cases.find(c=>c.lessonId===lesson.id&&c.conditionId===row.conditionId);assert.ok(expected);
      for(const s of row.curve.series)for(let i=0;i<row.curve.times.length;i++){const ref=referenceAt(expected,expected.series.find(c=>c.name===s.name).values,row.curve.times[i]),value=s.values[i];assert.ok(Math.abs(value-ref)<2e-5*Math.max(1,Math.abs(ref)),`${lesson.id}/${row.conditionId}/${s.name}/${row.curve.times[i]}: ${value} != ${ref}`);points++;}
      if(lesson.id==='conversion')for(let i=0;i<row.curve.times.length;i++)assert.ok(Math.abs(row.curve.series[0].values[i]-20*Math.exp(-.25*row.curve.times[i]))<1e-5);
    }
  }
  const state={...emptySystemsWorkspace(),lessonId:lesson.id,plan:study.plan,study};assert.deepEqual(readSystemsWorkspace(state),state);
  const doc=createDocument(`${lesson.id}.crn`,study.runs[0].request.code),saved=serialiseProject([doc],doc.id,new Map(),version,undefined,state);assert.deepEqual(parseProject(saved).systems,state);
  await writeFile(resolve(output,`${lesson.id}.systems.json`),JSON.stringify(state));
}
console.log(`Course validation passed: ${runs} real solver runs including 4 seeded replays; ${points} values against SciPy ${reference.reference.scipy} and analytic conversion; conserved populations, integer SSA output, project round trips.`);
