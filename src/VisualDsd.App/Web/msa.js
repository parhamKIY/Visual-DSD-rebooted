export const msaLimits={rows:50,columns:20000,symbols:500000,bytes:2*1024*1024};
const fail=message=>{throw new Error(`Multiple alignment: ${message}`);};
const alphabetLetters=type=>type==='DNA'?'ACGTRYSWKMBDHVN':type==='RNA'?'ACGURYSWKMBDHVN':type==='protein'?'ACDEFGHIKLMNPQRSTVWYBXZJUO*':fail('choose DNA, RNA or protein explicitly.');
const text=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('invalid text field.');return value;};
export function readMsa(raw){
  if(!raw||raw.version!==1||!Array.isArray(raw.records)||raw.records.length<2||raw.records.length>msaLimits.rows)fail('use 2–50 aligned sequences.');
  const letters=alphabetLetters(raw.alphabet),names=new Set();let width=null,total=0;
  const records=raw.records.map(r=>{
    const name=text(r.name,120),description=text(r.description??'',2000),sequence=text(r.sequence,msaLimits.columns);
    if(!name||/[\s>]/.test(name)||names.has(name))fail('identifiers must be unique and have no whitespace or >.');names.add(name);
    if(!sequence||[...sequence].some(c=>c!=='-'&&!letters.includes(c))||!sequence.replaceAll('-',''))fail(`${name}: invalid alphabet, empty sequence or all-gap row.`);
    if(width!==null&&sequence.length!==width)fail('all rows must have equal aligned lengths; missing gaps are never guessed.');width=sequence.length;total+=width;
    return {name,description,sequence};
  });
  if(total>msaLimits.symbols)fail('alignment exceeds 500000 symbols.');
  const source=raw.source;if(!source||!['fasta','clustal','example','muscle5'].includes(source.format))fail('invalid source format.');
  const result={version:1,alphabet:raw.alphabet,records,source:{format:source.format,file:text(source.file??'',240),text:text(source.text??'',msaLimits.bytes)},createdAt:text(raw.createdAt,80)};
  if(!Number.isFinite(Date.parse(result.createdAt)))fail('invalid import date.');
  if(raw.tool!=null){const t=raw.tool;if(t.name!=='MUSCLE 5'||typeof t.version!=='string'||t.version.length>500||!/^muscle\s+5[.\s]/i.test(t.version)||!/^[a-f0-9]{64}$/.test(t.executableSha256)||!/^[a-f0-9]{64}$/.test(t.inputSha256)||typeof t.inputFasta!=='string'||t.inputFasta.length>100000||!Array.isArray(t.arguments)||t.arguments.length>20||t.arguments.some(a=>typeof a!=='string'||a.length>200)||!Number.isFinite(Date.parse(t.finishedAt)))fail('invalid external-tool provenance.');result.tool={name:t.name,version:t.version,executableSha256:t.executableSha256,inputSha256:t.inputSha256,inputFasta:t.inputFasta,arguments:[...t.arguments],finishedAt:t.finishedAt,rawOutput:text(t.rawOutput??'',msaLimits.bytes),standardError:text(t.standardError??'',65536)};}
  return result;
}
export function parseMsa(input,alphabet,{file='',format='auto'}={}){
  if(typeof input!=='string'||new TextEncoder().encode(input).length>msaLimits.bytes)fail('input exceeds 2 MiB.');
  const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),first=lines.findIndex(l=>l.trim()),records=[];
  if(first<0)fail('no alignment found.');
  if(format==='auto')format=lines[first].startsWith('>')?'fasta':/^(CLUSTAL|MUSCLE)\b/.test(lines[first])?'clustal':fail('choose aligned FASTA or CLUSTAL text; this is not a supported alignment format.');
  if(format==='fasta'){
    let current=null;
    for(const line of lines){if(!line.trim()||line.startsWith(';'))continue;if(line.startsWith('>')){const m=line.slice(1).trim().match(/^(\S+)(?:\s+(.*))?$/);if(!m)fail('empty FASTA identifier.');current={name:m[1],description:m[2]??'',sequence:''};records.push(current);}else{if(!current)fail('FASTA must begin with >identifier.');const s=line.replace(/\s/g,'');if(/[^\x00-\x7f]/.test(s))fail('sequence symbols must be ASCII IUPAC letters.');current.sequence+=s.toUpperCase().replaceAll('.','-');}if(records.length>50||current?.sequence.length>msaLimits.columns)fail('alignment limits exceeded.');}
  }else if(format==='clustal'){
    if(!/^(CLUSTAL|MUSCLE)\b/.test(lines[first]))fail('CLUSTAL/MUSCLE header is missing.');
    let block=[];const finish=()=>{if(!block.length)return;const width=block[0].sequence.length;if(block.some(r=>r.sequence.length!==width)||new Set(block.map(r=>r.name)).size!==block.length)fail('unequal CLUSTAL block widths or repeated identifier.');if(!records.length)records.push(...block.map(r=>({...r,description:''})));else{if(block.length!==records.length||block.some((r,i)=>r.name!==records[i].name))fail('CLUSTAL blocks must repeat the same IDs in the same order.');block.forEach((r,i)=>records[i].sequence+=r.sequence);}block=[];};
    for(const line of lines.slice(first+1)){if(!line.trim()){finish();continue;}if(/^\s+[*:.\s]+$/.test(line))continue;const m=line.match(/^(\S+)\s+([A-Za-z.*-]+)(?:\s+\d+)?\s*$/);if(!m)fail('invalid CLUSTAL row.');block.push({name:m[1],sequence:m[2].toUpperCase().replaceAll('.','-')});}finish();
  }else fail('unsupported alignment format.');
  return readMsa({version:1,alphabet,records,source:{format,file,text:input},createdAt:new Date().toISOString()});
}
export function msaFasta(raw){return readMsa(raw).records.map(r=>`>${r.name}${r.description?' '+r.description.replace(/[\r\n]+/g,' '):''}\n${r.sequence.match(/.{1,70}/g).join('\n')}\n`).join('');}
export async function parseToolAlignment(response,alphabet,inputs){
  const inputFasta=inputs.map(r=>`>${r.name}\n${r.sequence}\n`).join(''),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(inputFasta)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(response?.tool?.inputSha256!==hash||response.tool.inputFasta!==inputFasta)fail('external-tool input digest mismatch.');
  const msa=parseMsa(response.text,alphabet,{file:'MUSCLE 5 output'});if(msa.records.length!==inputs.length||msa.records.some(r=>!inputs.some(input=>input.name===r.name&&input.sequence===r.sequence.replaceAll('-',''))))fail('external-tool output changed the input identifiers or sequence letters.');
  return readMsa({...msa,source:{...msa.source,format:'muscle5'},tool:response.tool});
}
export function calledLetters(alphabet){return alphabet==='DNA'?'ACGT':alphabet==='RNA'?'ACGU':'ACDEFGHIKLMNPQRSTVWYOU';}
export function msaColumns(raw){
  const msa=readMsa(raw),called=calledLetters(msa.alphabet),stats=[];
  for(let j=0;j<msa.records[0].sequence.length;j++){const counts={};let gaps=0,unknown=0;for(const r of msa.records){const c=r.sequence[j];if(c==='-')gaps++;else if(!called.includes(c))unknown++;else counts[c]=(counts[c]??0)+1;}const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),top=entries[0],tied=entries.length>1&&entries[1][1]===top[1];stats.push({position:j+1,gaps,unknown,called:msa.records.length-gaps-unknown,consensus:top&&!tied?top[0]:'?',fraction:top?top[1]/msa.records.length:0,conserved:gaps===0&&unknown===0&&entries.length===1});}
  return stats;
}
export function conservedRegions(stats){const regions=[];for(const c of stats)if(c.conserved){if(regions.at(-1)?.end===c.position-1)regions.at(-1).end=c.position;else regions.push({start:c.position,end:c.position});}return regions;}
export const msaExample='>Alpha Authored teaching alignment\nACGTACGTACGT\n>Beta\nACGTACGTTCGT\n>Gamma\nACGTTCGTTCGT\n>Delta\nACGTTCGTTC-T\n';
