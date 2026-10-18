import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {dsdFields,dsdDefaults,readDsdOptions,dsdOverrides,readDsdWorkspace,databaseIssues,sequenceCsv,sequenceFasta,filterExamples} from '../../src/VisualDsd.App/Web/dsd-workspace.js';
import {createDocument,requestFor,restoreWorkspace} from '../../src/VisualDsd.App/Web/model.js';
import {parseProject,serialiseProject,resultIsCurrent,readResponse} from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto??=webcrypto;
const options=()=>Object.fromEntries(dsdFields.map(f=>[f.name,f.kind==='bool'?false:f.kind==='string'?f.choices[0]:f.kind==='int'?6:1]));
const data=()=>({options:options(),sequenceStatus:'assigned',remainingToeholds:0,remainingSpecificities:0,sequences:[{domain:'a^',isToehold:true,sequence:'ACGTAC',reverseComplement:'GTACGT'},{domain:'b',isToehold:false,sequence:'AACCGGTTAA',reverseComplement:'TTAACCGGTT'}]});
const response=()=>({success:true,operation:'parse',dialect:'current',diagnostics:[],model:{kind:'classic',compilation:'default',isJit:false,settings:{simulator:'oslo',initial:0,final:1,points:3,seed:null,timeUnit:'s',concentrationUnit:'nM'},species:[],reactions:[],simulations:[],dsd:data()}});

test('source defaults omit overrides; explicit false and zero survive request creation',()=>{
  const doc=createDocument('test.dsd','<a>');assert.equal(requestFor(doc,'parse').dsdOptions,undefined);
  doc.options.dsdLeaks='false';doc.options.dsdToeholdBindRate='0';doc.options.dsdTemperature='-10';
  assert.deepEqual(requestFor(doc,'parse').dsdOptions,{leaks:false,toeholdBindRate:0,temperature:-10});
  doc.options.language='crn';doc.code='| 1 A';assert.equal(requestFor(doc,'parse').dsdOptions,undefined);
});

test('invalid settings reject unknown names, numeric strings, fractions, nonfinite values and enums',()=>{
  for(const raw of [{extra:true},{leaks:'false'},{renderer:'html'},{renderMode:'bad'},{arrange:'bad'},{predicates:'bad'},{toeholdLength:1.5},{specificityLength:257},{toeholdBindRate:-1},{toeholdUnbindRate:Infinity},{temperature:-273.15},{temperature:1001}])assert.throws(()=>readDsdOptions(raw));
  assert.throws(()=>dsdOverrides({...dsdDefaults,dsdLeaks:'0'}));
  assert.deepEqual(readDsdOptions({leaks:null}),{});
});

test('database diagnostics count trimmed lines and identify original DNA constraints',()=>{
  assert.deepEqual(databaseIssues(' ACGTAC \r\n\nTTAA','toeholds'),{count:2,issues:[]});
  assert.match(databaseIssues('acgt\nACGTACGTAC\nacgt','toeholds').issues.join(' '),/uppercase.*shorter.*duplicate/);
  assert.match(databaseIssues('ACGT','specificities').issues[0],/at least 10/);
});

test('sequence metadata independently verifies reverse-complement direction and assignment status',()=>{
  assert.deepEqual(readDsdWorkspace(data()),data());
  for(const mutate of [d=>d.sequences[0].reverseComplement='TGCATG',d=>d.sequences[0].sequence='acgtac',d=>d.sequences.push(d.sequences[0]),d=>d.remainingToeholds=-1,d=>delete d.options.jit,d=>d.sequenceStatus='incomplete',d=>d.sequenceStatus='unavailable']){const d=data();mutate(d);assert.throws(()=>readDsdWorkspace(d));}
  const d=data();d.sequences[0].sequence=d.sequences[0].reverseComplement=null;d.sequenceStatus='incomplete';assert.equal(readDsdWorkspace(d).sequenceStatus,'incomplete');
  assert.equal(readDsdWorkspace({...data(),sequenceStatus:'unavailable',sequences:[]}).sequences.length,0);
});

test('CSV retains missing assignments and FASTA exports both true orientations of known DNA only',()=>{
  const d=data();d.sequences.push({domain:'missing',isToehold:false,sequence:null,reverseComplement:null});
  assert.match(sequenceCsv(d),/"missing","specificity","unassigned","unassigned"/);
  const fasta=sequenceFasta(d);assert.match(fasta,/>domain_1 name=a\^.*\nACGTAC\n>domain_1_reverse_complement orientation=5to3\nGTACGT/);
  assert.doesNotMatch(fasta,/missing|null|undefined/);
  d.sequences[0].domain='name,"quoted"';assert.match(sequenceCsv(d),/"name,""quoted"""/);
});

test('example filtering matches category, path and every search term without changing source records',()=>{
  const examples=[{name:'Join',category:'Original · Manual',source:'Manual/Join-Nucleotides.txt',description:'Original source'},{name:'CRN',category:'Workspace',description:'Moment closure'}];
  assert.deepEqual(filterExamples(examples,'manual NUCLEOTIDES','Original · Manual'),[examples[0]]);
  assert.equal(filterExamples(examples,'join absent','').length,0);assert.deepEqual(filterExamples(examples,'','Workspace'),[examples[1]]);
});

test('settings and databases remain isolated per document and changes make previous results stale',()=>{
  const a=createDocument('a.dsd','<a>'),b=createDocument('b.dsd','<b>');a.options.dsdLeaks='true';a.databases.toeholds={name:'a.txt',code:'ACGTAC'};
  assert.equal(b.options.dsdLeaks,'');assert.deepEqual(b.databases,{});
  const snapshot={request:requestFor(a,'parse')};assert.equal(resultIsCurrent(a,snapshot),true);
  a.options.dsdLeaks='false';assert.equal(resultIsCurrent(a,snapshot),false);a.options.dsdLeaks='true';a.databases.toeholds.code='TTAA';assert.equal(resultIsCurrent(a,snapshot),false);
  const restored=restoreWorkspace(JSON.stringify({version:1,activeId:a.id,documents:[a,b]}));assert.equal(restored.documents[0].options.dsdLeaks,'true');assert.equal(restored.documents[1].options.dsdLeaks,'');
});

test('projects preserve effective DSD settings and DNA results; old projects default new controls',()=>{
  const doc=createDocument('model.dsd','<a^ b>');doc.options.dsdRenderer='classic';doc.databases.specificities={name:'custom.txt',code:'AACCGGTTAA'};
  const view={snapshot:{name:doc.name,request:requestFor(doc,'parse'),engineVersion:'0.16.0'},response:response(),tab:'dsd',runIndex:0};
  const text=serialiseProject([doc],doc.id,new Map([[doc.id,view]]),'0.16.0');
  const restored=parseProject(text);assert.deepEqual(restored.views.get(doc.id).response.model.dsd,data());assert.equal(restored.views.get(doc.id).tab,'dsd');assert.equal(restored.views.get(doc.id).revision,0);
  const bad=JSON.parse(text);bad.documents[0].result.response.model.dsd.options.renderer='circles';assert.throws(()=>parseProject(JSON.stringify(bad)));
  const old=JSON.parse(text);delete old.documents[0].result;for(const field of dsdFields)delete old.documents[0].options[field.id];assert.equal(parseProject(JSON.stringify(old)).documents[0].options.dsdRenderer,'');
});

test('DSD result metadata cannot disagree with the JIT flag or appear on CRN results',()=>{
  const r=response();r.model.dsd.options.jit=true;assert.throws(()=>readResponse(r));
  const original=response();assert.deepEqual(readResponse(original).model.dsd,original.model.dsd);
  const old=response();delete old.model.dsd;assert.equal(readResponse(old).model.dsd,undefined);
});
