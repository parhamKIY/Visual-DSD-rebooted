import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMsa,msaColumns,conservedRegions,msaFasta,msaExample,parseToolAlignment} from '../../src/VisualDsd.App/Web/msa.js';
import {parseNewick,toNewick,alignmentDistances,buildDistanceTree,treeEdges} from '../../src/VisualDsd.App/Web/phylogeny.js';
import {readEvolution} from '../../src/VisualDsd.App/Web/evolution-state.js';
import {readSequenceWorkspace,emptySequenceWorkspace} from '../../src/VisualDsd.App/Web/sequences.js';
import {createDocument} from '../../src/VisualDsd.App/Web/model.js';
import {parseProject,serialiseProject} from '../../src/VisualDsd.App/Web/project.js';
test('120 independent SciPy average-linkage and Biopython NJ reference cases match distances and branch paths',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/evolution-reference.json',import.meta.url),'utf8'));
 for(const c of fixture.cases){const built=buildDistanceTree(parseMsa(c.fasta,'DNA'),c.options),paths=new Map();function walk(node,path=[]){path=[...path,node];if(!node.children.length)paths.set(node.name,path);else node.children.forEach(n=>walk(n,path));}walk(built.tree.root);
  for(let i=0;i<c.names.length;i++)for(let j=0;j<c.names.length;j++){assert.ok(Math.abs(built.distance.matrix[i][j]-c.distance[i][j])<1e-10,JSON.stringify(c.options)+' distance');const a=paths.get(c.names[i]),b=paths.get(c.names[j]);let shared=0;while(shared<a.length&&shared<b.length&&a[shared]===b[shared])shared++;const d=[...a.slice(shared),...b.slice(shared)].reduce((s,n)=>s+(n.length??0),0);assert.ok(Math.abs(d-c.patristic[i][j])<1e-10,JSON.stringify({options:c.options,i,j,d,reference:c.patristic[i][j]}));}
 }
});
test('gapped FASTA and interleaved CLUSTAL preserve IDs, alphabet, exact input and equal width',()=>{
 const source='CLUSTAL W\n\na AC-G 3\nb ACGG 4\n  ** *\n\na TT\nb T-\n';const msa=parseMsa(source,'DNA');assert.equal(msa.records[0].sequence,'AC-GTT');assert.equal(msa.records[1].sequence,'ACGGT-');assert.equal(msa.source.text,source);assert.deepEqual(parseMsa(msaFasta(msa),'DNA').records,msa.records);
 for(const text of ['>a\nACG\n>b\nAC','>a\nAC\n>a\nAC','>a\n--\n>b\nAC','>a\nAß\n>b\nAC','CLUSTAL W\n\na AA\nb AA\n\nb CC\na CC'])assert.throws(()=>parseMsa(text,'DNA'));
 assert.equal(parseMsa('>a\nAC..\n>b\nACGT','DNA').records[0].sequence,'AC--');assert.throws(()=>parseMsa('>a\nACU\n>b\nACT','DNA'));
});
test('strict conservation requires all rows called and identical; consensus ties remain unknown',()=>{
 const stats=msaColumns(parseMsa('>a\nAC-N\n>b\nATGN','DNA'));assert.deepEqual(stats.map(c=>c.conserved),[true,false,false,false]);assert.equal(stats[1].consensus,'?');assert.equal(stats[2].fraction,.5);assert.equal(stats[3].unknown,2);assert.deepEqual(conservedRegions(stats),[{start:1,end:1}]);
});
test('Newick quotes, comments, support labels, rooting, polytomies and signed branch lengths roundtrip',()=>{
 const raw="[&U](('A one':1e-3,'B''two':-0.2)95[&&NHX:B=91]:.5,C_name:2,D:0);",tree=parseNewick(raw);assert.equal(tree.rooting,'unrooted');assert.deepEqual(tree.leaves.map(n=>n.name),['A one',"B'two",'C_name','D']);assert.equal(tree.root.children[0].name,'95');assert.equal(tree.root.children[0].comments[0],'&&NHX:B=91');assert.equal(treeEdges(tree).filter(e=>e.length<0).length,1);assert.deepEqual(parseNewick(toNewick(tree.root,tree.rooting)).leaves.map(n=>n.name),tree.leaves.map(n=>n.name));
 for(const invalid of ['(A,B)','(A,A);','(A:NaN,B);','(A,B);(C,D);',"('A,B);",'(,B);','[&U][&R](A,B);'])assert.throws(()=>parseNewick(invalid));
});
test('p-distance deletion policies count actual sites and never guess missing/saturated distances',()=>{
 const msa=parseMsa('>a\nAC-N\n>b\nATGN\n>c\nACGT','DNA'),complete=alignmentDistances(msa),pairwise=alignmentDistances(msa,{deletion:'pairwise'});assert.equal(complete.sites[0][1],2);assert.equal(complete.matrix[0][1],.5);assert.equal(pairwise.sites[1][2],3);assert.ok(Math.abs(pairwise.matrix[1][2]-1/3)<1e-10);
 assert.throws(()=>alignmentDistances(parseMsa('>a\nA-\n>b\n-G','DNA'),{deletion:'pairwise'}));assert.throws(()=>alignmentDistances(parseMsa('>a\nAAAA\n>b\nCCCC','DNA'),{model:'jc69'}));assert.throws(()=>alignmentDistances(parseMsa('>a\nMA\n>b\nMT','protein'),{model:'jc69'}));
});
test('UPGMA uses cardinality-weighted cluster distances and equal root-to-tip heights',()=>{
 const r=buildDistanceTree(parseMsa(msaExample,'DNA'),{method:'upgma'});assert.equal(r.tree.rooting,'rooted');const tips=[];function walk(n,d=0){d+=n.length??0;if(!n.children.length)tips.push(d);else n.children.forEach(c=>walk(c,d));}walk(r.tree.root);assert.ok(tips.every(v=>Math.abs(v-tips[0])<1e-10));assert.equal(r.tree.leaves.length,4);
});
test('NJ preserves an unrooted topology; two taxa, three taxa and negative edges are explicit',()=>{
 const r=buildDistanceTree(parseMsa(msaExample,'DNA'),{method:'nj'});assert.equal(r.tree.rooting,'unrooted');assert.equal(r.tree.root.children.length,3);
 assert.equal(buildDistanceTree(parseMsa('>a\nAC\n>b\nAT','DNA')).tree.leaves.length,2);
 const negative=buildDistanceTree(parseMsa('>a\nAA-\n>b\nC-A\n>c\n-AA','DNA'),{deletion:'pairwise'});assert.ok(treeEdges(negative.tree).some(e=>e.length<0));
});
test('external alignment output must retain the input letters, IDs and original input digest',async()=>{
 const inputs=[{name:'a',sequence:'AC'},{name:'b',sequence:'AGC'}],inputFasta='>a\nAC\n>b\nAGC\n',inputSha256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(inputFasta))).toString('hex'),tool={name:'MUSCLE 5',version:'muscle 5.3 test',inputFasta,inputSha256,executableSha256:'b'.repeat(64),arguments:['-align','input.fasta'],finishedAt:new Date().toISOString(),rawOutput:'>sequence_1\nA-C\n>sequence_2\nAGC\n',standardError:'test log'};
 const msa=await parseToolAlignment({text:'>a\nA-C\n>b\nAGC\n',tool},'DNA',inputs);assert.equal(msa.source.format,'muscle5');assert.equal(msa.tool.rawOutput,tool.rawOutput);
 await assert.rejects(()=>parseToolAlignment({text:'>a\nA-T\n>b\nAGC\n',tool},'DNA',inputs));await assert.rejects(()=>parseToolAlignment({text:'>a\nA-C\n>b\nAGC\n',tool:{...tool,inputSha256:'a'.repeat(64)}},'DNA',inputs));
});
test('alignment, trees and explicit record links survive standalone and main project roundtrips',()=>{
 const msa=parseMsa(msaExample,'DNA'),built=buildDistanceTree(msa,{method:'nj'}),study={id:'tree1',kind:'built',createdAt:new Date().toISOString(),file:'Built from alignment',notes:'Teaching example',newick:built.newick,version:built.version,alignment:msa,options:built.distance.options,inputSha256:'a'.repeat(64),links:{Alpha:'record-1'}},evolution={version:1,alignment:msa,trees:[study],activeTreeId:'tree1'};
 assert.deepEqual(readEvolution(evolution),evolution);const seq={...emptySequenceWorkspace(),analysis:{version:1,alignments:[],blast:null,search:null,evolution}},model=createDocument('test.dsd','<a>'),round=parseProject(serialiseProject([model],model.id,new Map(),'0.27.0',seq));assert.deepEqual(round.sequences.analysis.evolution,evolution);assert.deepEqual(readSequenceWorkspace(emptySequenceWorkspace()),emptySequenceWorkspace());
});
