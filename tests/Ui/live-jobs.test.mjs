import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readJob,watchJob,documentFromRequest,terminalJob,progressLabel} from '../../src/VisualDsd.App/Web/live-jobs.js';
import {requestFor} from '../../src/VisualDsd.App/Web/model.js';
globalThis.crypto??=webcrypto;
const id='a'.repeat(32);
const job=(state='running',revision=1)=>({id,state,revision,createdAt:'2026-10-18T00:00:00Z',startedAt:'2026-10-18T00:00:01Z',finishedAt:['cancelled','interrupted','failed'].includes(state)?'2026-10-18T00:00:02Z':null,result:null,progress:{phase:'simulating',message:'Solver output',time:0,preview:{times:[0],series:[{name:'A',values:[3]}]}},remoteId:null});

test('provisional progress rejects oversized, unordered, nonfinite and inconsistent updates',()=>{
 assert.equal(readJob(job()).progress.preview.series[0].values[0],3);
 for(const change of [j=>j.id='../x',j=>j.revision=-1,j=>j.state='fake',j=>j.finishedAt='2026-10-18',j=>j.progress.time=Infinity,j=>j.progress.preview.times=[2,1],j=>j.progress.preview.times=new Array(201).fill(0),j=>j.progress.preview.series[0].values=[NaN],j=>j.progress.preview.series[0].values=[],j=>j.progress.completed=3,j=>j.remoteId='../x']){const j=job();if(change.toString().includes('completed'))j.progress.total=2;change(j);assert.throws(()=>readJob(j));}
 assert.equal(terminalJob(job('interrupted')),true);assert.match(progressLabel(job()),/running.*Solver output.*t = 0/);
});

test('history reconstructs exact original requests including DSD flags, empty databases and inference data',()=>{
 const doc=documentFromRequest({code:'<a^ b>',operation:'parse',dialect:'current',compilation:'default',simulator:'ssa',timeoutSeconds:86400,toeholds:'',specificities:'AACCGGTTAA',dsdOptions:{leaks:false,renderer:'branches'}},'model.dsd');
 assert.equal(doc.name,'model.dsd');assert.equal(doc.options.timeoutSeconds,'86400');assert.equal(doc.databases.toeholds.code,'');
 assert.deepEqual(requestFor(doc,'parse').dsdOptions,{leaks:false,renderer:'branches'});
 const crn=documentFromRequest({code:'| 1 A',language:'crn',operation:'parse',nodeId:'n',systemId:''});assert.equal(crn.options.language,'crn');assert.equal(crn.options.systemId,'$top');
});

class Events{
 static last;
 constructor(url){this.url=url;this.listeners={};Events.last=this;this.closed=false;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 close(){this.closed=true;}
 emit(value){this.listeners.job({data:JSON.stringify(value)});}
}
test('SSE watches one admitted job, ignores older revisions and closes at the terminal snapshot',async()=>{
 const seen=[],pending=watchJob(id,j=>seen.push(j.revision),{EventSourceClass:Events});
 assert.equal(Events.last.url,`/api/jobs/${id}/events`);Events.last.emit(job('running',2));Events.last.emit(job('running',1));Events.last.emit(job('cancelled',3));
 assert.equal((await pending).state,'cancelled');assert.deepEqual(seen,[2,3]);assert.equal(Events.last.closed,true);
});
test('disconnect falls back to reads without submitting or cancelling the calculation',async()=>{
 const calls=[],pending=watchJob(id,()=>{},{EventSourceClass:Events,retryMs:1,fetcher:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>job('cancelled',3)};}});
 Events.last.onerror();assert.equal((await pending).state,'cancelled');assert.equal(calls.length,1);assert.equal(calls[0].url,`/api/jobs/${id}`);assert.equal(calls[0].options.method,undefined);
});
test('detaching monitoring aborts only the client and retains the server calculation',async()=>{
 const controller=new AbortController();let calls=0;
 const pending=watchJob(id,()=>{},{signal:controller.signal,EventSourceClass:Events,fetcher:async()=>{calls++;}});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(Events.last.closed,true);assert.equal(calls,0);
});
test('unknown jobs and invalid progress terminate monitoring without an automatic retry',async()=>{
 const missing=watchJob(id,()=>{},{EventSourceClass:null,fetcher:async()=>({status:404})});await assert.rejects(missing,/no longer retained/);
 const invalid=watchJob(id,()=>{},{EventSourceClass:Events});Events.last.emit({...job(),id:'b'.repeat(32)});await assert.rejects(invalid,/identifier mismatch/);
});
