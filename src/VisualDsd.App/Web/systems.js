import {systemLesson,systemSource} from './systems-lessons.js';

export const systemsKey='visual-dsd.systems.v1';
const fail=message=>{throw new Error(`Systems exercise: ${message}`);};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail('expected an object.');
const text=(v,max=4096)=>typeof v==='string'&&v.length<=max?v:fail('invalid text.');
const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi?v:fail('integer outside its allowed range.');
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:fail('nonfinite value.');
const same=(a,b)=>a&&typeof a==='object'&&!Array.isArray(a)&&JSON.stringify(Object.keys(a).sort())===JSON.stringify(Object.keys(b).sort())&&Object.keys(b).every(k=>a[k]===b[k]);
const date=v=>{text(v,40);if(!Number.isFinite(Date.parse(v)))fail('invalid date.');return v;};
// The retained SSA core writes its final output just before the OutputPoint
// event (rr=0.99999999 in ssa.fs). Keep that timestamp, never rewrite it.
const endTolerance=t=>Math.max(1,Math.abs(t))*1.01e-8+1e-10;
export function readSystemsPlan(raw={repeats:6,seed:42}){obj(raw);return {repeats:int(raw.repeats,2,12),seed:int(raw.seed,0,2147483636)};}
export function systemRequest(lessonId,conditionId,simulator,seed=null){
  const lesson=systemLesson(lessonId);if(!['oslo','ssa'].includes(simulator))fail('unknown simulator.');
  const request={code:systemSource(lessonId,conditionId),language:'crn',operation:'simulate',dialect:'current',compilation:'source',simulator,initial:0,final:lesson.final,points:150,timeoutSeconds:30};
  if(simulator==='ssa')request.seed=int(seed,0,2147483647);else if(seed!==null)fail('deterministic runs have no seed.');
  return request;
}
function runSpecs(lessonId,plan){return systemLesson(lessonId).conditions.flatMap(c=>[
  {conditionId:c.id,simulator:'oslo',repeat:0,seed:null},
  ...Array.from({length:plan.repeats},(_,i)=>({conditionId:c.id,simulator:'ssa',repeat:i+1,seed:plan.seed+i}))
]);}
export function newSystemsStudy(lessonId,rawPlan,engineVersion){
  const plan=readSystemsPlan(rawPlan);text(engineVersion,80);if(!engineVersion||engineVersion==='unknown')fail('wait for the engine version.');
  return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),modelVersion:1,engineVersion,lessonId,plan,runs:runSpecs(lessonId,plan).map(spec=>({...spec,state:'queued',request:systemRequest(lessonId,spec.conditionId,spec.simulator,spec.seed)}))};
}
export function emptySystemsWorkspace(){return {format:'visual-dsd-systems',version:1,lessonId:'conversion',plan:readSystemsPlan(),notes:{hypothesis:'',observations:'',interpretation:''},study:null};}
export function readSystemsCurve(raw,lessonId){
  obj(raw);const lesson=systemLesson(lessonId);if(!Array.isArray(raw.times)||raw.times.length<2||raw.times.length>20000)fail('invalid trajectory length.');
  const times=raw.times.map(finite);if(times[0]!==0||times.at(-1)<lesson.final-endTolerance(lesson.final)||times.some((t,i)=>t<0||t>lesson.final+endTolerance(lesson.final)||i&&t<times[i-1]))fail('trajectory does not cover the lesson interval.');
  if(!Array.isArray(raw.series)||raw.series.length!==lesson.species.length)fail('wrong trajectory species.');
  const series=lesson.species.map(name=>{const entries=raw.series.filter(s=>s.name===name);if(entries.length!==1)fail('missing or duplicate trajectory species.');const values=entries[0].values;if(!Array.isArray(values)||values.length!==times.length)fail('trajectory columns have different lengths.');return {name,values:values.map(finite)};});
  return {times,series,timeUnit:text(raw.timeUnit,100),concentrationUnit:text(raw.concentrationUnit,100)};
}
export function collectSystemsCurve(response,row,lessonId){
  if(!response?.success||response.operation!=='simulate'||response.model?.kind!=='crn'||response.model.simulations.length!==1)fail('expected one completed CRN simulation.');
  const run=response.model.simulations[0],settings=run.settings??response.model.settings;
  if(settings.simulator!==row.simulator||settings.initial!==0||settings.final!==row.request.final||settings.points!==150||row.simulator==='ssa'&&(run.seed!==row.seed||settings.seed!==row.seed))fail('solver settings or seed differ from the recorded request.');
  return readSystemsCurve({...run,timeUnit:settings.timeUnit,concentrationUnit:settings.concentrationUnit},lessonId);
}
export function readSystemsWorkspace(raw){
  if(raw==null)return emptySystemsWorkspace();obj(raw);if(raw.format!=='visual-dsd-systems'||raw.version!==1)fail('unsupported saved format.');
  const lessonId=text(raw.lessonId,80);systemLesson(lessonId);const plan=readSystemsPlan(raw.plan),notes={};obj(raw.notes);for(const key of ['hypothesis','observations','interpretation'])notes[key]=text(raw.notes[key],8000);
  let study=null;
  if(raw.study!=null){const s=obj(raw.study);systemLesson(s.lessonId);if(s.modelVersion!==1)fail('unsupported teaching model version.');
    const savedPlan=readSystemsPlan(s.plan),specs=runSpecs(s.lessonId,savedPlan);if(!Array.isArray(s.runs)||s.runs.length!==specs.length)fail('wrong number of saved runs.');
    const jobs=new Set();const runs=s.runs.map((r,i)=>{obj(r);const spec=specs[i];for(const key of Object.keys(spec))if(r[key]!==spec[key])fail('run order, seed or condition changed.');
      const request=systemRequest(s.lessonId,spec.conditionId,spec.simulator,spec.seed);
      if(!same(r.request,request))fail('source or calculation settings differ from the retained teaching model.');
      if(!['queued','admitting','running','succeeded','failed','cancelled','timedOut','interrupted'].includes(r.state))fail('unknown execution state.');
      const result={...spec,state:r.state,request};
      if(r.jobId!=null){if(!/^[a-f0-9]{32}$/i.test(r.jobId)||jobs.has(r.jobId))fail('invalid or duplicated job identifier.');jobs.add(r.jobId);result.jobId=r.jobId;}
      if(r.state==='queued'&&r.jobId||['running','succeeded','failed','cancelled','timedOut'].includes(r.state)&&!r.jobId)fail('missing or inconsistent job admission.');
      if(r.message!=null)result.message=text(r.message);
      if(r.engineVersion!=null){if(r.engineVersion!==s.engineVersion)fail('result engine version differs from the study.');result.engineVersion=r.engineVersion;}
      if(r.state==='succeeded'){
        if(r.engineVersion!==s.engineVersion)fail('result engine version differs from the study.');result.engineVersion=r.engineVersion;
        result.curve=readSystemsCurve(r.curve,s.lessonId);
        if(result.curve.timeUnit!=='s'||result.curve.concentrationUnit!=='nM')fail('unexpected lesson units.');
        if(spec.simulator==='ssa'&&result.curve.series.some(c=>c.values.some(v=>v<0||!Number.isInteger(v))))fail('scale=1 SSA requires nonnegative integer populations.');
      }else if(r.curve!=null)fail('an unfinished run cannot contain a completed trajectory.');
      return result;
    });
    study={id:text(s.id,80),createdAt:date(s.createdAt),modelVersion:1,engineVersion:text(s.engineVersion,80),lessonId:s.lessonId,plan:savedPlan,runs};
    if(!study.id||!study.engineVersion||study.engineVersion==='unknown')fail('missing study provenance.');
    if(study.lessonId!==lessonId)fail('saved study belongs to another lesson.');
  }
  return {format:'visual-dsd-systems',version:1,lessonId,plan,notes,study};
}
// Right-continuous zero-order hold for SSA samples. No invented linear event path.
export function systemSample(curve,name,time,mode='ssa'){
  if(!Number.isFinite(time)||time<curve.times[0]||time>curve.times.at(-1)+endTolerance(time))fail('sample time outside the retained trajectory.');
  const column=curve.series.find(s=>s.name===name);if(!column)fail('unknown species.');
  let lo=0,hi=curve.times.length;while(lo<hi){const m=(lo+hi)>>>1;if(curve.times[m]<=time)lo=m+1;else hi=m;}
  const i=Math.max(0,lo-1),a=column.values[i];
  if(mode==='ssa'||i===curve.times.length-1||time===curve.times[i])return a;
  return a+(column.values[i+1]-a)*(time-curve.times[i])/(curve.times[i+1]-curve.times[i]);
}
export function systemStats(values){
  values.forEach(finite);const n=values.length;if(!n)return {n,mean:null,sd:null,cv:null,fano:null,min:null,max:null};
  const scale=Math.max(...values.map(Math.abs))||1,x=values.map(v=>v/scale),m=x.reduce((s,v)=>s+v/n,0),mean=m*scale;
  const variance=n>1?x.reduce((s,v)=>s+(v-m)**2/(n-1),0):null,sd=variance==null?null:Math.sqrt(variance)*scale;
  const fano=mean>0&&variance!=null?variance*scale*(scale/mean):null;
  return {n,mean,sd:Number.isFinite(sd)?sd:null,cv:mean>0&&sd!=null?sd/mean:null,fano:Number.isFinite(fano)?fano:null,min:Math.min(...values),max:Math.max(...values)};
}
export function systemsSummary(study,name){
  const lesson=systemLesson(study.lessonId);if(!lesson.species.includes(name))fail('unknown species.');
  return lesson.conditions.map(c=>{const runs=study.runs.filter(r=>r.conditionId===c.id),ssa=runs.filter(r=>r.simulator==='ssa'&&r.state==='succeeded'),ode=runs.find(r=>r.simulator==='oslo'&&r.state==='succeeded');
    return {conditionId:c.id,requested:study.plan.repeats,unavailable:study.plan.repeats-ssa.length,deterministic:ode?systemSample(ode.curve,name,lesson.final,'oslo'):null,...systemStats(ssa.map(r=>systemSample(r.curve,name,lesson.final)))};
  });
}
export function systemsComparison(study,conditionId,name,kind='summary'){
  const lesson=systemLesson(study.lessonId),runs=study.runs.filter(r=>r.conditionId===conditionId&&r.state==='succeeded'),ssa=runs.filter(r=>r.simulator==='ssa'),ode=runs.find(r=>r.simulator==='oslo');
  const times=Array.from({length:151},(_,i)=>lesson.final*i/150),series=[];
  if(kind==='individual'){
    const selected=ssa.find(r=>r.seed===Number(name.seed)),species=name.species;
    if(!selected)return {times:[],series:[]};
    const points=[...new Set([...selected.curve.times,...times])].sort((a,b)=>a-b);
    if(ode)series.push({name:'ODE',mode:'linear',values:points.map(t=>systemSample(ode.curve,species,t,'oslo'))});
    series.push({name:`SSA · seed ${selected.seed}`,values:points.map(t=>systemSample(selected.curve,species,t))});
    return {times:points,series,mode:'step'};
  }
  if(ode)series.push({name:'ODE',values:times.map(t=>systemSample(ode.curve,name,t,'oslo'))});
  if(ssa.length){const stats=times.map(t=>systemStats(ssa.map(r=>systemSample(r.curve,name,t))));series.push({name:`SSA · n=${ssa.length}`,values:stats.map(s=>s.mean),...(ssa.length>1?{standardDeviation:stats.map(s=>s.sd)}:{})});}
  return {times:series.length?times:[],series};
}
export function systemsInvariant(row,lessonId){
  if(row.state!=='succeeded')return null;
  const names=lessonId==='conversion'?['A','B']:lessonId==='expression'?['Off','On']:['G','R'],target=lessonId==='conversion'?20:1;
  const columns=names.map(n=>row.curve.series.find(s=>s.name===n).values);
  return {expression:`${names.join('+')}=${target}`,maxAbsoluteError:Math.max(...row.curve.times.map((_,i)=>Math.abs(columns.reduce((s,c)=>s+c[i],0)-target)))};
}
export function systemsCsv(study){
  const rows=[['Condition','Solver','Repeat','Seed','State','Engine','Job','Time','Species','Value','Time unit','Concentration unit','Diagnostic']];
  for(const row of study.runs){const prefix=[row.conditionId,row.simulator,row.repeat,row.seed??'',row.state,row.engineVersion??study.engineVersion,row.jobId??''];
    if(row.state==='succeeded')for(let i=0;i<row.curve.times.length;i++)for(const c of row.curve.series)rows.push([...prefix,row.curve.times[i],c.name,c.values[i],row.curve.timeUnit,row.curve.concentrationUnit,'']);
    else rows.push([...prefix,'','','','','',row.message??'']);
  }
  return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
}
