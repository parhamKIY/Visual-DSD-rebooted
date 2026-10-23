// Biological sequence documents are independent of DSD domain/strand mappings.
export const sequenceLimits={records:100,bases:1000000,recordBases:200000,fileBytes:5*1024*1024};
export const nucleotideCodes={A:'A',C:'C',G:'G',T:'T',R:'AG',Y:'CT',S:'CG',W:'AT',K:'GT',M:'AC',B:'CGT',D:'AGT',H:'ACT',V:'ACG',N:'ACGT'};
const complements={A:'T',T:'A',C:'G',G:'C',R:'Y',Y:'R',S:'S',W:'W',K:'M',M:'K',B:'V',V:'B',D:'H',H:'D',N:'N'};
const fail=message=>{throw new Error(`Sequences: ${message}`);};
const text=(value,max=1000)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('invalid text field.');return value;};
export function validateSequence(input,alphabet){
  if(!['DNA','RNA','protein'].includes(alphabet))fail('choose DNA, RNA or protein explicitly.');
  text(input,sequenceLimits.fileBytes);const sequence=input.replace(/\s/g,'').toUpperCase();
  if(!sequence.length||sequence.length>sequenceLimits.recordBases)fail('use 1–200000 sequence symbols per record.');
  const allowed=alphabet==='protein'?'ACDEFGHIKLMNPQRSTVWYBXZJUO*':alphabet==='DNA'?'ACGTRYSWKMBDHVN':'ACGURYSWKMBDHVN';
  for(let i=0;i<sequence.length;i++)if(!allowed.includes(sequence[i]))fail(`invalid ${alphabet} symbol “${sequence[i]}” at position ${i+1}. Use ungapped IUPAC sequences; RNA uses U and DNA uses T.`);
  return sequence;
}
export function makeSequence({name,description='',alphabet,sequence,source={format:'manual',file:''},genbank=null,provenance=null}){
  name=text(name,120);if(!name.trim()||/[\s>]/.test(name))fail('record identifiers must be nonempty, without whitespace or >.');
  return {id:crypto.randomUUID(),name,description:text(description,2000),alphabet,sequence:validateSequence(sequence,alphabet),source,genbank,provenance};
}
export function parseFasta(input,alphabet,{file=''}={}){
  if(typeof input!=='string'||new TextEncoder().encode(input).length>sequenceLimits.fileBytes)fail('input exceeds 5 MiB.');
  const records=[];let header=null,parts=[];
  const finish=()=>{if(header===null)return;const match=header.match(/^(\S+)(?:\s+(.*))?$/);if(!match)fail('empty FASTA identifier.');records.push(makeSequence({name:match[1],description:match[2]??'',alphabet,sequence:parts.join(''),source:{format:'fasta',file:text(file,240)}}));};
  for(const [index,line] of input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').entries()){
    if(!line.trim()||line.startsWith(';'))continue;
    if(line.startsWith('>')){finish();header=line.slice(1).trim();parts=[];if(records.length>=sequenceLimits.records)fail('a workspace supports at most 100 records.');}
    else {if(header===null)fail(`line ${index+1}: FASTA must begin with >identifier.`);parts.push(line);}
  }
  finish();if(!records.length)fail('no FASTA records found.');
  if(new Set(records.map(r=>r.name)).size!==records.length)fail('duplicate FASTA identifiers; give each record a distinct identifier.');
  return readSequenceWorkspace({version:1,records,activeId:records[0].id}).records;
}
export function sequenceStats(record){
  const sequence=validateSequence(record.sequence,record.alphabet),counts={};for(const c of sequence)counts[c]=(counts[c]??0)+1;
  if(record.alphabet==='protein')return {length:sequence.length,residues:sequence.length-(counts['*']??0),stops:counts['*']??0,ambiguous:[...sequence].filter(c=>'BXZJ'.includes(c)).length,counts,gc:null,gcMin:null,gcMax:null};
  let called=0,gc=0,min=0,max=0,ambiguous=0;
  for(const c of sequence){const values=nucleotideCodes[c==='U'?'T':c];if(values.length===1){called++;if('GC'.includes(values))gc++;}else ambiguous++;if([...values].every(v=>'GC'.includes(v)))min++;if([...values].some(v=>'GC'.includes(v)))max++;}
  return {length:sequence.length,called,ambiguous,counts,gc:called?100*gc/called:null,gcMin:100*min/sequence.length,gcMax:100*max/sequence.length};
}
export function reverseComplement(sequence,alphabet='DNA'){
  if(alphabet==='protein')fail('a protein has no nucleotide complement.');
  return [...validateSequence(sequence,alphabet)].reverse().map(c=>{const value=complements[c==='U'?'T':c];return alphabet==='RNA'&&value==='T'?'U':value;}).join('');
}
// NCBI transl_table 1, 2, 11; codons in T,C,A,G order at each position.
// https://www.ncbi.nlm.nih.gov/datasets/docs/v2/data-processing/taxonomy-processing/genetic-codes/
const standard='FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
export const geneticCodes={
  1:{name:'Standard',aas:standard,starts:['TTG','CTG','ATG']},
  2:{name:'Vertebrate mitochondrial',aas:'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG',starts:['ATT','ATC','ATA','ATG','GTG']},
  11:{name:'Bacterial, archaeal & plant plastid',aas:standard,starts:['TTG','CTG','ATT','ATC','ATA','ATG','GTG']}
};
function codonInfo(codon,table){
  const codons=[''];for(const c of codon){const options=nucleotideCodes[c];codons.splice(0,codons.length,...codons.flatMap(prefix=>[...options].map(base=>prefix+base)));}
  const residues=[...new Set(codons.map(c=>table.aas['TCAG'.indexOf(c[0])*16+'TCAG'.indexOf(c[1])*4+'TCAG'.indexOf(c[2])]))];
  return {residue:residues.length===1?residues[0]:'X',mayStop:residues.includes('*'),certainStart:codons.every(c=>table.starts.includes(c))};
}
export function translateSequence(record,{frame=1,table=1,toStop=false,cds=false}={}){
  if(record.alphabet==='protein')fail('translation requires DNA or RNA.');
  if(![1,2,3,-1,-2,-3].includes(frame)||!Object.hasOwn(geneticCodes,table)||typeof toStop!=='boolean'||typeof cds!=='boolean')fail('invalid translation options.');
  let sequence=validateSequence(record.sequence,record.alphabet);if(frame<0)sequence=reverseComplement(sequence,record.alphabet);sequence=sequence.replace(/U/g,'T').slice(Math.abs(frame)-1);
  const tail=sequence.length%3,code=geneticCodes[table],codons=[];for(let i=0;i+2<sequence.length;i+=3)codons.push(codonInfo(sequence.slice(i,i+3),code));
  if(!codons.length)fail('the selected frame has no complete codon.');
  if(cds&&(tail||!codons[0].certainStart||codons.at(-1).residue!=='*'||codons.slice(1,-1).some(c=>c.mayStop)))fail('complete CDS mode requires a valid start, a final stop, no partial codon and no possible internal stop. Exceptions such as transl_except are not applied.');
  let protein='',stoppedAt=null;const ambiguousStopCodons=[];
  for(let i=0;i<codons.length;i++){const codon=codons[i];if(codon.mayStop&&codon.residue==='X')ambiguousStopCodons.push(i+1);if((toStop||cds)&&codon.residue==='*'){stoppedAt=i+1;break;}protein+=cds&&i===0?'M':codon.residue;}
  if(!protein.length)fail('translation contains no amino-acid output before the first stop.');
  return {sequence:protein,details:{frame,table:Number(table),tableName:code.name,toStop,cds,trailingBases:tail,stoppedAt,ambiguousStopCodons,annotationExceptionsApplied:false}};
}
export async function deriveSequence(record,operation,options={}){
  const input=readSequenceRecord(record);let alphabet=input.alphabet,sequence,details={};
  if(operation==='reverse-complement')sequence=reverseComplement(input.sequence,alphabet);
  else if(operation==='transcribe'){
    if(alphabet!=='DNA')fail('transcription starts from the displayed DNA coding strand (5′→3′).');
    alphabet='RNA';sequence=input.sequence.replace(/T/g,'U');details={strand:'displayed coding strand',splicingApplied:false};
  }else if(operation==='back-transcribe'){
    if(alphabet!=='RNA')fail('back transcription requires RNA.');alphabet='DNA';sequence=input.sequence.replace(/U/g,'T');
  }else if(operation==='translate'){const translated=translateSequence(input,options);alphabet='protein';sequence=translated.sequence;details=translated.details;}
  else fail('unknown sequence operation.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.sequence)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const provenance={operation,inputId:input.id,inputName:input.name,inputAlphabet:input.alphabet,inputLength:input.sequence.length,inputSha256:hash,createdAt:new Date().toISOString(),options:details,sourceFeatureCount:input.genbank?.features.length??0,annotationsCopied:false};
  return makeSequence({name:`${input.name.slice(0,90)}_${operation==='translate'?`protein_${options.frame??1}`:operation.replaceAll('-','_')}`,description:`${operation} of ${input.name}`,alphabet,sequence,source:{format:'derived',file:''},provenance});
}
export function readSequenceRecord(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid sequence record.');
  const record=makeSequence(raw);record.id=text(raw.id,80);if(!/^[A-Za-z0-9_-]{1,80}$/.test(record.id))fail('invalid sequence record identifier.');
  if(!raw.source||!['manual','fasta','genbank','derived','example'].includes(raw.source.format))fail('invalid sequence source.');
  record.source={format:raw.source.format,file:text(raw.source.file??'',240)};
  if(raw.genbank!==null&&raw.genbank!==undefined){
    const g=raw.genbank;if(!g||typeof g!=='object'||!Array.isArray(g.features)||g.features.length>2000||!['linear','circular'].includes(g.topology))fail('invalid GenBank metadata.');
    record.genbank={locus:text(g.locus,120),accession:text(g.accession??'',500),version:text(g.version??'',120),definition:text(g.definition??'',4000),organism:text(g.organism??'',1000),topology:g.topology,raw:text(g.raw,sequenceLimits.fileBytes),features:g.features.map(f=>{
      if(!f||!/^[-A-Za-z0-9_'*]{1,15}$/.test(f.key)||!Array.isArray(f.qualifiers)||f.qualifiers.length>300)fail('invalid feature.');
      return {key:f.key,location:text(f.location,4000),qualifiers:f.qualifiers.map(q=>{if(!q||!/^[-A-Za-z0-9_'*]{1,30}$/.test(q.name))fail('invalid feature qualifier.');return {name:q.name,value:q.value===null?null:text(q.value,50000)};})};
    })};
  }
  if(raw.provenance!==null&&raw.provenance!==undefined){
    const p=raw.provenance;if(!p||!['reverse-complement','transcribe','back-transcribe','translate'].includes(p.operation)||!Number.isFinite(Date.parse(p.createdAt))||!/^[a-f0-9]{64}$/.test(p.inputSha256)||!['DNA','RNA','protein'].includes(p.inputAlphabet)||!Number.isInteger(p.inputLength)||p.inputLength<1||p.inputLength>sequenceLimits.recordBases||!Number.isInteger(p.sourceFeatureCount)||p.sourceFeatureCount<0||p.sourceFeatureCount>2000||p.annotationsCopied!==false||!p.options||typeof p.options!=='object'||Array.isArray(p.options)||JSON.stringify(p.options).length>4000)fail('invalid conversion provenance.');
    record.provenance={operation:p.operation,inputId:text(p.inputId,80),inputName:text(p.inputName,120),inputAlphabet:p.inputAlphabet,inputLength:p.inputLength,inputSha256:p.inputSha256,createdAt:p.createdAt,options:structuredClone(p.options),sourceFeatureCount:p.sourceFeatureCount,annotationsCopied:false};
  }
  return record;
}
export function emptySequenceWorkspace(){return {version:1,records:[],activeId:null};}
export function readSequenceWorkspace(raw){
  if(raw==null)return emptySequenceWorkspace();
  if(raw.version!==1||!Array.isArray(raw.records)||raw.records.length>sequenceLimits.records)fail('invalid sequence workspace version or record count.');
  const records=raw.records.map(readSequenceRecord);
  if(new Set(records.map(r=>r.id)).size!==records.length||records.reduce((sum,r)=>sum+r.sequence.length,0)>sequenceLimits.bases)fail('duplicate record IDs or workspace exceeds 1000000 symbols.');
  if(records.length?!records.some(r=>r.id===raw.activeId):raw.activeId!==null)fail('selected sequence is missing.');
  return {version:1,records,activeId:raw.activeId};
}
export function addSequences(workspace,added){
  const existing=new Set(workspace.records.map(r=>r.name));const records=added.map(raw=>{const r=readSequenceRecord(raw),base=r.name;let suffix=2;while(existing.has(r.name))r.name=`${base.slice(0,110)}_${suffix++}`;existing.add(r.name);return r;});
  return readSequenceWorkspace({...workspace,records:[...workspace.records,...records],activeId:records[0]?.id??workspace.activeId});
}
export function fastaFor(records){
  return records.map(raw=>{const r=readSequenceRecord(raw);return `>${r.name}${r.description?' '+r.description.replace(/[\r\n]+/g,' '):''}\n${r.sequence.match(/.{1,70}/g).join('\n')}\n`;}).join('');
}
