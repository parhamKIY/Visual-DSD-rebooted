export const blastFields='qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore';
const allowed=new Set((blastFields+' qlen slen qcovhsp qcovs stitle').split(' '));
const aliases={'query id':'qseqid','subject id':'sseqid','% identity':'pident','alignment length':'length',mismatches:'mismatch','gap opens':'gapopen','q. start':'qstart','q. end':'qend','s. start':'sstart','s. end':'send',evalue:'evalue','bit score':'bitscore','query length':'qlen','subject length':'slen','% query coverage per hsp':'qcovhsp','% query coverage per subject':'qcovs','subject title':'stitle'};
const fail=message=>{throw new Error(`BLAST: ${message}`);};
const bounded=(v,max=1000)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail('invalid text metadata.');return v;};
export function evalueLog(value){
  if(typeof value!=='string'||!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,5})?$/i.test(value)||value.length>80)fail('invalid nonnegative E-value.');
  const [mantissa,power='0']=value.toLowerCase().split('e'),digits=mantissa.replace(/^\+/,'').split('.'),all=digits.join(''),first=all.search(/[1-9]/);
  if(first<0)return -Infinity;
  return Number(power)+digits[0].length-first-1+Math.log10(Number(all.slice(first,first+15))/10**(Math.min(15,all.length-first)-1));
}
function fieldsFor(text){const fields=text.trim().split(/[\s,]+/);if(!fields.length||new Set(fields).size!==fields.length||fields.some(f=>!allowed.has(f))||blastFields.split(' ').some(f=>!fields.includes(f)))fail('include the 12 standard fields; optional fields: qlen slen qcovhsp qcovs stitle. Unsupported custom columns are never guessed.');return fields;}
export function parseBlast(input,{fields=blastFields,file='',databaseVersion='',kind='imported'}={}){
  if(typeof input!=='string'||new TextEncoder().encode(input).length>2*1024*1024)fail('use a tabular file of at most 2 MiB.');
  bounded(file,240);bounded(databaseVersion,300);if(!['imported','authored-example'].includes(kind))fail('invalid source kind.');
  let columns=fieldsFor(fields),program='',database='',query='',sawComment=false;const hits=[],queries=new Set();
  for(const [index,line] of input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').entries()){
    if(!line.trim())continue;
    if(line.startsWith('#')){sawComment=true;const value=line.slice(1).trim();if(/^BLAST\w*\s+\S+/.test(value))program=bounded(value,240);else if(value.startsWith('Database:'))database=bounded(value.slice(9).trim(),500);else if(value.startsWith('Query:')){query=bounded(value.slice(6).trim(),1000).split(/\s/)[0];queries.add(query);}else if(value.startsWith('Fields:')){const names=value.slice(7).trim().split(/,\s*/).map(f=>aliases[f.toLowerCase()]??f);columns=fieldsFor(names.join(' '));}continue;}
    if(hits.length>=5000)fail('at most 5000 HSP rows.');const values=line.split('\t');if(values.length!==columns.length)fail(`line ${index+1}: expected ${columns.length} TAB-separated columns, received ${values.length}. Choose the exact outfmt field list.`);
    const row=Object.fromEntries(columns.map((f,i)=>[f,values[i]]));
    for(const key of ['qseqid','sseqid'])if(!row[key]||/\s/.test(row[key])||row[key].length>500)fail(`line ${index+1}: invalid sequence identifier.`);
    const integer=(key,min=0)=>{if(!/^\d+$/.test(row[key])||!Number.isSafeInteger(Number(row[key]))||Number(row[key])<min)fail(`line ${index+1}: invalid ${key}.`);row[key]=Number(row[key]);};
    for(const f of ['length','qstart','qend','sstart','send'])integer(f,1);for(const f of ['mismatch','gapopen'])integer(f);
    for(const f of ['pident','bitscore','qcovhsp','qcovs'])if(row[f]!==undefined){if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(row[f])||!Number.isFinite(Number(row[f]))||Number(row[f])<0||(f!=='bitscore'&&Number(row[f])>100))fail(`line ${index+1}: invalid ${f}.`);row[f]=Number(row[f]);}
    for(const f of ['qlen','slen'])if(row[f]!==undefined)integer(f,1);
    if(row.mismatch>row.length||row.gapopen>row.length||row.qlen&&Math.max(row.qstart,row.qend)>row.qlen||row.slen&&Math.max(row.sstart,row.send)>row.slen)fail(`line ${index+1}: inconsistent lengths or coordinates.`);
    if(row.stitle!==undefined)bounded(row.stitle,2000);evalueLog(row.evalue);
    if(query&&row.qseqid!==query)fail(`line ${index+1}: query ID disagrees with its comment header.`);
    queries.add(row.qseqid);hits.push(row);
  }
  if(!hits.length&&!sawComment)fail('no BLAST rows found. Use outfmt 6 or 7; XML/JSON/pairwise text are not tabular input.');
  return {version:1,kind,file,databaseVersion,program,database,queries:[...queries],fields:columns.join(' '),text:input,hits};
}
export function readBlastImport(raw){
  if(raw==null)return null;if(raw.version!==1||!Number.isFinite(Date.parse(raw.importedAt)))fail('invalid saved BLAST import.');
  const parsed=parseBlast(raw.text,raw);return {...parsed,importedAt:raw.importedAt};
}
export function hspCoverage(row){return row.qcovhsp??(row.qlen?100*(Math.abs(row.qend-row.qstart)+1)/row.qlen:null);}
export function filterBlast(result,{query='',minimumIdentity=0,minimumCoverage=0,maximumEvalue='10',sort='evalue'}={}){
  const ceiling=evalueLog(maximumEvalue);
  if(![minimumIdentity,minimumCoverage].every(v=>Number.isFinite(v)&&v>=0&&v<=100)||!['evalue','bitscore','identity'].includes(sort))fail('invalid filter.');
  return result.hits.filter(h=>(!query||h.qseqid===query)&&h.pident>=minimumIdentity&&(minimumCoverage===0||hspCoverage(h)!==null&&hspCoverage(h)>=minimumCoverage)&&evalueLog(h.evalue)<=ceiling).sort((a,b)=>sort==='bitscore'?b.bitscore-a.bitscore:sort==='identity'?b.pident-a.pident:evalueLog(a.evalue)-evalueLog(b.evalue)||b.bitscore-a.bitscore);
}
export const blastExample='# BLASTN authored teaching data; NOT an executed search\n# Query: toy_query\n# Database: authored_toy_database\n# Fields: query id, subject id, % identity, alignment length, mismatches, gap opens, q. start, q. end, s. start, s. end, evalue, bit score, query length, subject title\ntoy_query\ttoy_subject_A\t95\t20\t1\t0\t1\t20\t5\t24\t1e-8\t38\t40\tAuthored high-identity partial hit\ntoy_query\ttoy_subject_A\t90\t20\t2\t0\t15\t34\t30\t49\t2e-5\t28\t40\tOverlapping HSP; coverage must not be summed\ntoy_query\ttoy_subject_B\t80\t40\t8\t0\t1\t40\t80\t41\t0.02\t22\t40\tAuthored reverse-direction full-length hit\n# 3 hits found\n';
