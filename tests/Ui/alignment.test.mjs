import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alignPair,alignmentVersion,alignmentText,readAlignmentStudy} from '../../src/VisualDsd.App/Web/alignment.js';
import {parseBlast,blastFields,blastExample,filterBlast,evalueLog,hspCoverage} from '../../src/VisualDsd.App/Web/blast.js';
import {emptySequenceWorkspace,readSequenceWorkspace,makeSequence,addSequences} from '../../src/VisualDsd.App/Web/sequences.js';
import {serialiseProject,parseProject} from '../../src/VisualDsd.App/Web/project.js';
import {createDocument} from '../../src/VisualDsd.App/Web/model.js';
const dna=sequence=>({name:'test',alphabet:'DNA',sequence});
const rescore=(a,b,o)=>{let score=0,last='';for(let i=0;i<a.length;i++){const gap=a[i]==='-'?'a':b[i]==='-'?'b':'';score+=gap?(gap===last?o.extend:o.open):(a[i]===b[i]?o.match:o.mismatch);last=gap;}return score;};
test('440 independently generated Biopython reference cases: scores, optimal counts and paths',()=>{
 const reference=JSON.parse(readFileSync(new URL('./fixtures/alignment-reference.json',import.meta.url),'utf8'));
 for(const c of reference.cases){const r=alignPair(dna(c.a),dna(c.b),c.options),context=JSON.stringify({a:c.a,b:c.b,options:c.options});assert.ok(Math.abs(r.score-c.score)<1e-8,context+' score');assert.equal(r.optimalCount,c.count,context+' count');if(c.count<30)for(const row of r.alignments)assert.ok(c.alignments.some(a=>a.a===row.a&&a.b===row.b&&a.startA===row.startA&&a.endA===row.endA&&a.startB===row.startB&&a.endB===row.endB),context+' path');}
});
test('global alignment penalizes terminal gaps and uses open+(L-1)*extend',()=>{
 const r=alignPair(dna('AAAAAA'),dna('AA'),{open:-3,extend:-.5});assert.equal(r.score,-.5);assert.equal(r.optimalCount,3);
 for(const a of r.alignments){assert.equal(a.a.replaceAll('-',''),'AAAAAA');assert.equal(a.b.replaceAll('-',''),'AA');assert.equal(rescore(a.a,a.b,r.options),r.score);}assert.match(alignmentText(r),/1-based/);
});
test('literal ambiguity, RNA, proteins and invalid scoring/alphabet boundaries',()=>{
 assert.equal(alignPair(dna('N'),dna('N')).score,2);assert.equal(alignPair(dna('N'),dna('A')).score,-1);
 assert.equal(alignPair({name:'a',alphabet:'RNA',sequence:'AUG'},{name:'b',alphabet:'RNA',sequence:'AUG'}).score,6);
 assert.equal(alignPair({name:'a',alphabet:'protein',sequence:'MAFK'},{name:'b',alphabet:'protein',sequence:'MAWK'}).score,5);
 assert.throws(()=>alignPair(dna('A'.repeat(501)),dna('A')));assert.throws(()=>alignPair(dna('A'),{name:'b',alphabet:'RNA',sequence:'A'}));
 for(const o of [{open:0},{extend:1},{match:0},{mismatch:1},{match:.333}])assert.throws(()=>alignPair(dna('A'),dna('A'),o));
});
test('local finds a true internal region, zero yields no alignment, tied endpoints retained',()=>{
 const r=alignPair(dna('TTACGTAA'),dna('GGACGTCC'),{mode:'local'});assert.equal(r.score,8);assert.deepEqual([r.alignments[0].startA,r.alignments[0].endA,r.alignments[0].startB,r.alignments[0].endB],[3,6,3,6]);assert.equal(r.alignments[0].coverageA,50);
 const zero=alignPair(dna('AAA'),dna('CCC'),{mode:'local'});assert.equal(zero.score,0);assert.equal(zero.optimalCount,0);assert.equal(zero.alignments.length,0);
 const ties=alignPair(dna('ATA'),dna('A'),{mode:'local'});assert.equal(ties.optimalCount,2);assert.equal(ties.alignments.length,2);
});
test('global ties, affine state changes, bounded enumeration and independently rescored paths',()=>{
 const tie=alignPair(dna('AA'),dna('A'));assert.equal(tie.optimalCount,2);assert.equal(new Set(tie.alignments.map(a=>a.b)).size,2);
 const opposite=alignPair(dna('ACA'),dna('AGA'),{mismatch:-10,open:-1,extend:-1});assert.equal(opposite.score,2);assert.equal(opposite.optimalCount,2);
 let seed=12;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let iteration=0;iteration<60;iteration++){const sequence=()=>Array.from({length:1+Math.floor(random()*8)},()=>'ACGT'[Math.floor(random()*4)]).join('');for(const mode of ['global','local']){const r=alignPair(dna(sequence()),dna(sequence()),{mode,open:-1.5,extend:-.25});for(const row of r.alignments)assert.ok(Math.abs(rescore(row.a,row.b,r.options)-r.score)<1e-8);assert.ok(r.alignments.length<=20);}}
});
test('saved sequence studies preserve input snapshots and old workspaces remain compatible',()=>{
 const input={version:alignmentVersion,createdAt:'2026-10-23T00:00:00Z',first:dna('ACGT'),second:dna('AGT'),options:{}};
 const workspace=addSequences(emptySequenceWorkspace(),[makeSequence({...dna('ACGT'),source:{format:'manual',file:''}})]);
 const round=readSequenceWorkspace({...workspace,analysis:{version:1,alignments:[input],blast:null,search:null}});assert.equal(round.analysis.alignments[0].first.sequence,'ACGT');assert.equal(alignPair(round.analysis.alignments[0].first,round.analysis.alignments[0].second).score,4);
 const model=createDocument('test.dsd','<a>'),blast={...parseBlast(blastExample,{kind:'authored-example'}),importedAt:'2026-10-23T00:00:00Z'};round.analysis.blast=blast;
 const restored=parseProject(serialiseProject([model],model.id,new Map(),'0.26.0',round)).sequences;assert.equal(restored.analysis.blast.text,blastExample);assert.deepEqual(restored.analysis.alignments,round.analysis.alignments);
 assert.deepEqual(readSequenceWorkspace(emptySequenceWorkspace()),emptySequenceWorkspace());assert.throws(()=>readAlignmentStudy({...input,version:'future'}));
});
test('BLAST outfmt 7 preserves HSP rows, comments, reverse coordinates and explicit example origin',()=>{
 const r=parseBlast(blastExample,{kind:'authored-example'});assert.equal(r.hits.length,3);assert.equal(r.kind,'authored-example');assert.equal(r.database,'authored_toy_database');assert.equal(hspCoverage(r.hits[0]),50);assert.equal(r.hits[2].send,41);assert.equal(filterBlast(r,{minimumIdentity:90}).length,2);assert.equal(filterBlast(r,{minimumCoverage:90}).length,1);
 assert.equal(parseBlast('# BLASTN 2.16.0+\n# Query: absent\n# Database: nt\n# 0 hits found').hits.length,0);
});
test('BLAST strict fields, numbers, underflow E-values and unsupported formats',()=>{
 const raw='q\ts\t95\t20\t1\t0\t1\t20\t24\t5\t1e-500\t38';const r=parseBlast(raw);assert.equal(r.hits[0].evalue,'1e-500');assert.equal(filterBlast(r,{maximumEvalue:'1e-400'}).length,1);assert.equal(evalueLog('0'),-Infinity);assert.ok(Math.abs(evalueLog('0.02')-Math.log10(.02))<1e-9);
 assert.equal(hspCoverage(r.hits[0]),null);assert.equal(filterBlast(r,{minimumCoverage:1}).length,0);
 for(const bad of [raw.replace('95','101'),raw.replace('1e-500','-1'),raw.replace('1e-500','NaN'),raw.replaceAll('\t',' '),'<xml/>'])assert.throws(()=>parseBlast(bad));
 assert.throws(()=>parseBlast(raw,{fields:blastFields+' unknown'}));assert.throws(()=>parseBlast(raw+'\t10',{fields:blastFields+' qlen'}));
});
