import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readExports, exportSummary, populationSnapshotSvg } from '../../src/VisualDsd.App/Web/exports.js';
import { createDocument, requestFor } from '../../src/VisualDsd.App/Web/model.js';
import { readResponse, parseProject, serialiseProject } from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto??=webcrypto;
const file=()=>({id:'sbml',name:'SBML',fileName:'run-001-sbml.xml',contentType:'application/sbml+xml',content:'<sbml/>',diagnostic:null,run:'prediction',sweep:'doses',assignment:'N=5'});
function response(){return {success:true,operation:'export',dialect:'current',diagnostics:[],model:{kind:'classic',compilation:'default',isJit:false,settings:{simulator:'oslo',initial:0,final:1,points:10,seed:null,timeUnit:'s',concentrationUnit:'nM'},species:[{id:'a',name:'<a>',structure:'<a>',svg:'',initial:'1',constant:false,time:null,valueKind:'initial'}],reactions:[],simulations:[],exports:[file()]}};}
test('scientific files and explicit unavailable formats survive projects exactly',()=>{
  const doc=createDocument('export.dsd','<a>'),r=response();
  const view={response:r,snapshot:{request:requestFor(doc,'export'),name:doc.name,engineVersion:'0.15.0'},tab:'exports',runIndex:0,networkFocus:''};
  const saved=serialiseProject([doc],doc.id,new Map([[doc.id,view]]),'0.15.0');
  const restored=parseProject(saved).views.get(doc.id);assert.deepEqual(restored.response,r);assert.equal(restored.tab,'exports');
  const unavailable={...file(),content:null,diagnostic:{code:'EXPORT_UNSUPPORTED',message:'Scheduled inputs require events.'}};
  assert.deepEqual(readExports([unavailable]),[unavailable]);assert.equal(exportSummary([file(),unavailable]),'1 files ready · 1 unavailable');
});
test('export readers reject mismatched file types, path traversal, duplicates and fake success',()=>{
  for(const mutation of [{fileName:'../model.xml'},{fileName:'run-001-sbml.exe'},{contentType:'text/html'},{id:'unknown'},{content:'',diagnostic:null},{content:null,diagnostic:null},{diagnostic:{code:'E',message:'failure'}},{run:null}])assert.throws(()=>readExports([{...file(),...mutation}]));
  assert.throws(()=>readExports([file(),file()]));assert.throws(()=>readExports([]));assert.throws(()=>readExports([{...file(),content:'A'.repeat(4*1024*1024+1)}]));
});
test('scientific data cannot masquerade as a simulation or disappear from an export result',()=>{
  const r=response();assert.deepEqual(readResponse(r),r);delete r.model.exports;assert.throws(()=>readResponse(r));
  const other=response();other.operation='parse';assert.throws(()=>readResponse(other));
});
test('UTF-8 budgets and download filenames remain bounded',()=>{
  assert.throws(()=>readExports([{...file(),content:'آ'.repeat(3*1024*1024)}]));
  const a=file(),b={...file(),fileName:'run-002-sbml.xml',assignment:'N=7'};
  assert.equal(readExports([a,b])[1].assignment,'N=7');
});
test('final population SVG uses complete selected JIT populations and embeds diagrams as images',()=>{
  const model={isJit:true,settings:{timeUnit:'s'}};
  const run={times:[0,1.25],network:{species:[{id:'s1',initial:'7',valueKind:'finalPopulation',structure:'<a>',svg:'<svg xmlns="http://www.w3.org/2000/svg"/>'},{id:'input',initial:'9',valueKind:'scheduledInput'},{id:'s2',initial:'0',valueKind:'finalPopulation',name:'<b>'}]}};
  const svg=populationSnapshotSvg(model,run);assert.match(svg,/s1 = 7/);assert.match(svg,/s2 = 0/);assert.match(svg,/1.25 s/);assert.doesNotMatch(svg,/input|= 9|<b>/);assert.match(svg,/data:image\/svg\+xml/);
  assert.throws(()=>populationSnapshotSvg({...model,isJit:false},run));
});
