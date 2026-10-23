import {readStudyPlan,readLogicConfig,variantConfig,newLogicBatch,caseRequest,readout,sampleAt,readLogicState} from './logic.js';
import {caseMetrics} from './logic-analysis.js';

export function newStudy(base,config,rawPlan,engineVersion){
  const c=readLogicConfig(config,true),plan=readStudyPlan(rawPlan,c),batches=[];
  for(const variant of plan.variants)for(let repeat=0;repeat<plan.repeats;repeat++)batches.push(newLogicBatch(base,variantConfig(c,variant),engineVersion,{traceInputs:true,execution:{simulator:plan.simulator,seed:plan.simulator==='ssa'?plan.seed+repeat*16:null,parameters:variant.parameters}}));
  return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),engineVersion,request:structuredClone(base),config:c,plan,batches};
}
export function studyIsCurrent(base,config,rawPlan,study){
  try{return JSON.stringify(base)===JSON.stringify(study.request)&&JSON.stringify(readLogicConfig(config))===JSON.stringify(study.config)&&JSON.stringify(readStudyPlan(rawPlan,config))===JSON.stringify(study.plan);}catch{return false;}
}
export function studyRows(study){return study.batches.flatMap((batch,index)=>batch.cases.map((row,caseIndex)=>({batch,row,caseIndex,variantIndex:Math.floor(index/study.plan.repeats),repeat:index%study.plan.repeats,seed:batch.execution.simulator==='ssa'?batch.execution.seed+caseIndex:null})));}
export function statistics(values){
  const finite=values.filter(Number.isFinite);if(finite.length!==values.length)throw new Error('Nonfinite comparison measurement.');
  if(!values.length)return {n:0,mean:null,sd:null,min:null,max:null};
  // Scaling keeps the mean finite for large finite trajectories.
  const scale=Math.max(...values.map(Math.abs))||1,normal=values.map(v=>v/scale),mean=normal.reduce((a,b)=>a+b/values.length,0),sd=values.length>1?Math.sqrt(normal.reduce((sum,v)=>sum+(v-mean)**2,0)/(values.length-1))*scale:null;
  return {n:values.length,mean:mean*scale,sd:Number.isFinite(sd)?sd:null,min:Math.min(...values),max:Math.max(...values)};
}
export function studySummary(study){
  const records=studyRows(study);
  return study.plan.variants.flatMap((variant,variantIndex)=>study.batches[variantIndex*study.plan.repeats].cases.flatMap((example,caseIndex)=>study.config.outputs.map((output,outputIndex)=>{
    const group=records.filter(r=>r.variantIndex===variantIndex&&r.caseIndex===caseIndex),concentrations=[],leakages=[],margins=[],responses=[],counts={correct:0,incorrect:0,unknown:0,unavailable:0,notReached:0};
    for(const {batch,row} of group){const verdict=readout(batch.config,row),metric=caseMetrics(batch.config,row,batch.analysis??{start:0,end:batch.config.time});
      if(row.state!=='succeeded'||!verdict.outputs[outputIndex]||metric.state!=='available'){counts.unavailable++;continue;}
      const m=metric.outputs[outputIndex];counts[verdict.outputs[outputIndex].status]++;concentrations.push(verdict.outputs[outputIndex].one);margins.push(m.margin);if(m.leakage)leakages.push(m.leakage.value);if(m.response.delay===null)counts.notReached++;else responses.push(m.response.delay);
    }
    return {variant:variant.label,variantIndex,caseIndex,bits:example.bits,output:output.name,expected:example.expected[outputIndex],total:group.length,counts,concentration:statistics(concentrations),leakage:statistics(leakages),margin:statistics(margins),response:statistics(responses)};
  })));
}
export function studyCsv(study){
  const headers=['Variant','Repeat','Case','Output','Expected','Observed','Logical status','Execution state','Seed','Simulator','ON factor','OFF factor','Parameters','Read time','Concentration','Leakage peak','Threshold margin','Response status','Response delay','Concentration unit','Time unit','Engine version','Study','Batch','Job','Diagnostic'];
  const rows=studyRows(study).flatMap(r=>{
    const verdict=readout(r.batch.config,r.row),metrics=caseMetrics(r.batch.config,r.row,r.batch.analysis??{start:0,end:r.batch.config.time}),variant=study.plan.variants[r.variantIndex];
    return r.batch.config.outputs.map((o,n)=>[variant.label,r.repeat+1,r.row.bits.join(''),o.name,r.row.expected[n],verdict.outputs[n]?.observed??'',verdict.outputs[n]?.status??'',r.row.state,r.seed??'',r.batch.execution.simulator,variant.onFactor,variant.offFactor,variant.parameters.map(p=>`${p.name}=${p.value}`).join('; '),r.batch.config.time,verdict.outputs[n]?.one??'',metrics.outputs[n]?.leakage?.value??'',metrics.outputs[n]?.margin??'',metrics.outputs[n]?.response.status??'',metrics.outputs[n]?.response.delay??'',r.batch.config.unit,r.batch.config.timeUnit,study.engineVersion,study.id,r.batch.id,r.row.jobId??'',r.row.message??metrics.message??'']);
  });
  const cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;return [headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function compareCurves(study,caseIndex,outputIndex){
  const output=study.config.outputs[outputIndex],records=studyRows(study).filter(r=>r.caseIndex===caseIndex&&r.row.state==='succeeded');
  return records.map(r=>({variant:study.plan.variants[r.variantIndex].label,repeat:r.repeat+1,seed:r.seed,curve:{...r.row.curve,series:r.row.curve.series.filter(s=>s.name===output.one||s.name===output.zero)}}));
}
