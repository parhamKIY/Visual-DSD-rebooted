import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateSequence,makeSequence,parseFasta,sequenceStats,reverseComplement,translateSequence,deriveSequence,readSequenceWorkspace,addSequences,emptySequenceWorkspace,fastaFor} from '../../src/VisualDsd.App/Web/sequences.js';
import {parseGenbank,genbankFor,featureLocation} from '../../src/VisualDsd.App/Web/genbank.js';
globalThis.crypto??=webcrypto;
const dna=(sequence='ATGGCCTTTAAATGA')=>makeSequence({name:'teaching',alphabet:'DNA',sequence});
const gb=`LOCUS       TEACHING                  15 bp    DNA     linear   SYN 01-JAN-2000
DEFINITION  An authored teaching sequence, not an experimental record.
ACCESSION   TEACHING
VERSION     TEACHING.1
FEATURES             Location/Qualifiers
     source          1..15
                     /organism="synthetic construct"
     CDS             1..15
                     /gene="toyA"
                     /codon_start=1
                     /transl_table=1
                     /translation="MAFK"
                     /note="A note with ""quoted"" words
                     across two lines."
     misc_feature    complement(join(<1..3,
                     10..>15))
                     /note="Partial joined region"
ORIGIN
        1 atggccttta aatga
//
`;
test('multi-record FASTA preserves metadata and case-insensitive IUPAC symbols, with explicit type',()=>{
  const rows=parseFasta('\uFEFF>first description\r\nacgt nry\r\n;comment\r\n>second\r\nSSWW\r\n','DNA');assert.equal(rows.length,2);assert.equal(rows[0].description,'description');assert.equal(rows[0].sequence,'ACGTNRY');assert.deepEqual(parseFasta(fastaFor(rows),'DNA').map(r=>r.sequence),rows.map(r=>r.sequence));
  assert.equal(validateSequence('mkwvuo*xj','protein'),'MKWVUO*XJ');assert.equal(validateSequence('ACGU N','RNA'),'ACGUN');
  for(const raw of ['>x\nACGT\n>x\nA','ACGT','>empty\n','>x\nAC-GT','>x\nACGT1','>x\nACGU'])assert.throws(()=>parseFasta(raw,'DNA'));
  assert.throws(()=>validateSequence('ATGC','RNA'));assert.throws(()=>validateSequence('A'.repeat(200001),'DNA'));
});
test('reverse complement handles all IUPAC bases, preserves 5-to-3 convention and is involutive',()=>{
  assert.equal(reverseComplement('ACGTRYSWKMBDHVN'),'NBDHVKMWSRYACGT');
  for(const type of ['DNA','RNA']){const sequence=type==='DNA'?'ACGTRYSWKMBDHVN':'ACGURYSWKMBDHVN';assert.equal(reverseComplement(reverseComplement(sequence,type),type),sequence);}
  assert.equal(reverseComplement('AUGC','RNA'),'GCAU');assert.throws(()=>reverseComplement('MA','protein'));
});
test('GC uses called bases explicitly and reports rigorous ambiguity bounds instead of assigning N=0.5',()=>{
  const s=sequenceStats(dna('ACGTSN'));assert.equal(s.gc,50);assert.equal(s.gcMin,50);assert.equal(s.gcMax,100*4/6);assert.equal(s.ambiguous,2);
  assert.deepEqual([sequenceStats(dna('NN')).gc,sequenceStats(dna('NN')).gcMin,sequenceStats(dna('NN')).gcMax],[null,0,100]);assert.equal(sequenceStats(dna('SS')).gcMin,100);
  assert.equal(sequenceStats(makeSequence({name:'p',alphabet:'protein',sequence:'MWX*'})).gc,null);
});
test('translation agrees with published genetic-code examples, frame offsets and coding-strand RNA',()=>{
  assert.equal(translateSequence(dna()).sequence,'MAFK*');assert.equal(translateSequence(dna('ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG')).sequence,'MAIVMGR*KGAR*');
  assert.equal(translateSequence(dna('ATATGAAGAAGG'),{table:1}).sequence,'I*RR');assert.equal(translateSequence(dna('ATATGAAGAAGG'),{table:2}).sequence,'MW**');
  assert.equal(translateSequence(dna('AATGGCC'),{frame:2}).sequence,'MA');assert.equal(translateSequence(dna('GGCCAT'),{frame:-1}).sequence,'MA');assert.equal(translateSequence(dna('GCNTGY'),{frame:1}).sequence,'AC');assert.equal(translateSequence(dna('AANTAN')).sequence,'XX');assert.deepEqual(translateSequence(dna('AANTAN')).details.ambiguousStopCodons,[2]);
  const partial=translateSequence(dna('ATGGC'));assert.equal(partial.sequence,'M');assert.equal(partial.details.trailingBases,2);assert.equal(translateSequence(dna(),{toStop:true}).sequence,'MAFK');
  assert.equal(translateSequence(makeSequence({name:'r',alphabet:'RNA',sequence:'AUGGCC'})).sequence,'MA');assert.throws(()=>translateSequence(dna(),{table:99}));assert.throws(()=>translateSequence(dna('AT'),{frame:1}));
});
test('complete CDS validation uses table-specific starts and rejects hidden internal/ambiguous stops',()=>{
  assert.equal(translateSequence(dna('GTGGCCTAA'),{table:11,cds:true}).sequence,'MA');assert.equal(translateSequence(dna('GTGGCCTAA'),{table:11}).sequence,'VA*');assert.throws(()=>translateSequence(dna('GTGGCCTAA'),{table:1,cds:true}));
  for(const sequence of ['ATGGCCTAAA','ATGGCC','ATGTAATAA','ATGTANTAA'])assert.throws(()=>translateSequence(dna(sequence),{cds:true}));
});
test('conversions retain the original and record input hash, frame, code and annotation policy',async()=>{
  const record=parseGenbank(gb)[0],before=structuredClone(record),rna=await deriveSequence(record,'transcribe'),protein=await deriveSequence(record,'translate',{frame:1,table:1,cds:true});
  assert.deepEqual(record,before);assert.equal(rna.sequence,'AUGGCCUUUAAAUGA');assert.equal(rna.provenance.options.splicingApplied,false);assert.equal(protein.sequence,'MAFK');assert.equal(protein.genbank,null);assert.equal(protein.provenance.sourceFeatureCount,3);assert.match(protein.provenance.inputSha256,/^[0-9a-f]{64}$/);
  const back=await deriveSequence(rna,'back-transcribe');assert.equal(back.sequence,record.sequence);assert.throws(()=>readSequenceWorkspace({version:1,records:[{...protein,provenance:{...protein.provenance,inputSha256:'fake'}}],activeId:protein.id}));
});
test('GenBank parses multiple records, qualifiers, repeated keys and partial reverse joined locations',()=>{
  const records=parseGenbank(gb+gb.replaceAll('TEACHING','OTHER'));assert.equal(records.length,2);const r=records[0];assert.equal(r.sequence,'ATGGCCTTTAAATGA');assert.equal(r.genbank.features.length,3);assert.equal(r.genbank.features[1].qualifiers.find(q=>q.name==='note').value,'A note with "quoted" words across two lines.');
  const location=featureLocation(r.genbank.features[2].location,r.sequence.length);assert.equal(location.partial,true);assert.deepEqual(location.segments.map(s=>[s.start,s.end,s.strand]),[[10,15,-1],[1,3,-1]]);
  const round=parseGenbank(genbankFor(records));assert.deepEqual(round.map(r=>r.sequence),records.map(r=>r.sequence));assert.deepEqual(round[0].genbank.features,r.genbank.features);assert.equal(round[0].genbank.version,'TEACHING.1');
  assert.throws(()=>parseGenbank(gb.replace('15 bp','16 bp')));assert.throws(()=>parseGenbank(gb.replace('//','')));assert.throws(()=>parseGenbank(gb.replace('1..15','1..99')));
});
test('RNA GenBank T convention, proteins and unresolved annotations are never guessed into local spans',()=>{
  const r=parseGenbank(gb.replace('DNA     linear','mRNA    linear'))[0];assert.equal(r.alphabet,'RNA');assert.equal(r.sequence,'AUGGCCUUUAAAUGA');assert.equal(parseGenbank(genbankFor([r]))[0].sequence,r.sequence);
  assert.equal(featureLocation('J00194.1:100..202',15).resolved,false);assert.equal(featureLocation('one-of(1,2)',15).resolved,false);assert.equal(featureLocation('order(1..3,10..12)',15).ordered,true);assert.throws(()=>featureLocation('3^8',15));assert.equal(featureLocation('15^1',15,'circular').segments[0].between,true);
  const p=makeSequence({name:'protein',alphabet:'protein',sequence:'MAFK'});assert.equal(parseGenbank(genbankFor([p]))[0].alphabet,'protein');
});
test('sequence workspace roundtrip is independent of model limits, atomic on failure and rejects malformed data',()=>{
  const record=dna(),workspace=addSequences(emptySequenceWorkspace(),[record]);assert.deepEqual(readSequenceWorkspace(JSON.parse(JSON.stringify(workspace))),workspace);
  const same=dna();assert.equal(addSequences(workspace,[same]).records[1].name,'teaching_2');assert.equal(workspace.records.length,1);
  for(const raw of [{...workspace,activeId:'missing'},{...workspace,records:[record,record]},{...workspace,version:2}])assert.throws(()=>readSequenceWorkspace(raw));
  assert.throws(()=>addSequences(workspace,[{...same,sequence:'invalid!'}]));assert.equal(workspace.records.length,1);
});
