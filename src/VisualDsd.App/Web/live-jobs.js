import {createDocument} from './model.js';
import {normaliseRequest,readResponse} from './project.js';
import {dsdFields} from './dsd-workspace.js';

const states=['queued','running','cancelling','cancelled','succeeded','failed','timedOut','interrupted'];
export const terminalJob=job=>['cancelled','succeeded','failed','timedOut','interrupted'].includes(job.state);
export function readJob(raw){
  const fail=()=>{const error=new Error('Invalid calculation update.');error.name='InvalidJobError';throw error;};
  if(!raw||typeof raw.id!=='string'||!/^[a-f0-9]{32}$/i.test(raw.id)||!states.includes(raw.state)||!Number.isSafeInteger(raw.revision)||raw.revision<0)fail();
  if(!Number.isFinite(Date.parse(raw.createdAt))||[raw.startedAt,raw.finishedAt].some(t=>t!=null&&!Number.isFinite(Date.parse(t)))||terminalJob(raw)!==Boolean(raw.finishedAt))fail();
  if(raw.remoteId!=null&&!/^[a-f0-9]{32}$/i.test(raw.remoteId))fail();
  const p=raw.progress;
  if(p!=null){
    if(!['preparing','expanding','simulating','inference','exploring','exporting','synthesis','completed','remote'].includes(p.phase)||typeof p.message!=='string'||p.message.length>512||p.run!=null&&(typeof p.run!=='string'||p.run.length>512)||p.time!=null&&!Number.isFinite(p.time))fail();
    if([p.completed,p.total].some(n=>n!=null&&(!Number.isInteger(n)||n<0))||p.completed!=null&&p.total!=null&&p.completed>p.total)fail();
    const v=p.preview;
    if(v!=null&&(!Array.isArray(v.times)||v.times.length>200||v.times.some((t,i)=>!Number.isFinite(t)||i>0&&t<v.times[i-1])||!Array.isArray(v.series)||v.series.length>8||v.series.some(s=>!s||typeof s.name!=='string'||s.name.length>512||!Array.isArray(s.values)||s.values.length!==v.times.length||s.values.some(n=>!Number.isFinite(n))||s.standardDeviation!=null)))fail();
  }
  if(raw.result?.success)readResponse(raw.result);
  return raw;
}
export function documentFromRequest(raw,name='Calculation'){
  const r=normaliseRequest(raw),doc=createDocument(`${name.slice(0,100).replace(/\.(dsd|vdsd|crn)$/i,'')}.${r.language==='crn'?'crn':'dsd'}`,r.code,r.dialect);
  for(const key of ['compilation','simulator','initial','final','points','seed','timeoutSeconds','nodeId','phaseX','phaseY','phaseTrajectories'])if(r[key]!=null)doc.options[key]=String(r[key]);
  if(r.systemId!=null)doc.options.systemId=r.systemId||'$top';
  for(const field of dsdFields)if(r.dsdOptions?.[field.name]!=null)doc.options[field.id]=String(r.dsdOptions[field.name]);
  for(const key of ['toeholds','specificities'])if(r[key]!=null)doc.databases[key]={name:`Job ${key}.txt`,code:r[key]};
  doc.data=r.data??[];return doc;
}
export function progressLabel(job){
  const p=job.progress;
  return [job.state,p?.message,p?.run,p?.time!=null?`t = ${p.time}`:'',p?.completed!=null&&p?.total!=null?`${p.completed} / ${p.total} chains`:''].filter(Boolean).join(' · ');
}

// Reconnection only reads the admitted job. It never submits or cancels work.
export function watchJob(id,onUpdate,{signal,onDisconnect=()=>{},EventSourceClass=globalThis.EventSource,fetcher=globalThis.fetch,retryMs=1500}={}){
  return new Promise((resolve,reject)=>{
    let source,done=false,last=-1,polling=false;
    const close=()=>{source?.close();signal?.removeEventListener('abort',abort);};
    const finish=(error,value)=>{if(done)return;done=true;close();error?reject(error):resolve(value);};
    const abort=()=>finish(new DOMException('Monitoring detached; the calculation continues.','AbortError'));
    const update=raw=>{const job=readJob(raw);if(job.id!==id)throw new Error('Calculation identifier mismatch.');if(job.revision<last)return;last=job.revision;onUpdate(job);if(terminalJob(job))finish(null,job);};
    async function poll(){
      if(polling||done)return;polling=true;source?.close();
      while(!done){
        try{const r=await fetcher(`/api/jobs/${id}`,{signal});if(r.status===404){finish(new Error('This calculation is no longer retained by the service.'));return;}if(!r.ok)throw new Error('Connection unavailable.');update(await r.json());}
        catch(error){if(done)return;if(error.name==='AbortError'){abort();return;}if(error.name==='InvalidJobError'){finish(error);return;}onDisconnect();}
        if(!done)await new Promise(resolve=>{const wake=()=>{clearTimeout(timer);signal?.removeEventListener('abort',wake);resolve();};const timer=setTimeout(wake,retryMs);signal?.addEventListener('abort',wake,{once:true});});
      }
    }
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    if(!EventSourceClass){poll();return;}
    source=new EventSourceClass(`/api/jobs/${id}/events`);
    source.addEventListener('job',event=>{try{update(JSON.parse(event.data));}catch(error){finish(error);}});
    source.addEventListener('gone',()=>finish(new Error('This calculation is no longer retained by the service.')));
    source.onerror=()=>{onDisconnect();poll();};
  });
}
