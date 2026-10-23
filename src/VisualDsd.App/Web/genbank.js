import {makeSequence,readSequenceRecord,readSequenceWorkspace,sequenceLimits,validateSequence} from './sequences.js';
const fail=message=>{throw new Error(`GenBank: ${message}`);};
// Coordinates are one-based, inclusive. Unsupported/remote syntax stays visible,
// but is never guessed or used as a local feature span.
export function featureLocation(location,length,topology='linear'){
  const value=String(location).replace(/\s/g,'');let unresolved=false,partial=false,ordered=false;
  if(value.includes('join(')&&value.includes('order('))return {segments:[],resolved:false,partial:false,ordered:true,label:'Nested join/order is unsupported; no local span is inferred.'};
  function parse(s,strand=1,depth=0){
    if(depth>20)fail('feature location nesting exceeds 20.');
    const operator=s.match(/^(complement|join|order)\((.*)\)$/);
    if(operator){const [,kind,inside]=operator;if(kind==='complement')return parse(inside,-strand,depth+1).reverse();if(kind==='order')ordered=true;
      const parts=[];let level=0,start=0;for(let i=0;i<inside.length;i++){if(inside[i]==='(')level++;if(inside[i]===')')level--;if(level<0){unresolved=true;return [];}if(inside[i]===','&&level===0){parts.push(inside.slice(start,i));start=i+1;}}parts.push(inside.slice(start));if(level||parts.some(p=>!p)){unresolved=true;return [];}return parts.flatMap(p=>parse(p,strand,depth+1));
    }
    if(/^[A-Za-z][A-Za-z0-9_.]*:/.test(s)){unresolved=true;return [];}
    const match=s.match(/^([<>]?)(\d+)(?:(\.\.|\^)([<>]?)(\d+))?$/);if(!match){unresolved=true;return [];}
    const start=Number(match[2]),end=Number(match[5]??match[2]),between=match[3]==='^',fuzzy=Boolean(match[1]||match[4]);partial||=fuzzy;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<1||start>length||end>length||(!between&&start>end)||between&&!(end===start+1||topology==='circular'&&start===length&&end===1))fail(`feature location is outside the record or not adjacent: ${location}`);
    return [{start,end,strand,partial:fuzzy,between}];
  }
  const segments=parse(value);return {segments,resolved:!unresolved,partial,ordered,label:unresolved?'Remote or unsupported location; local coverage is incomplete.':ordered?'Ordered regions; continuity is not implied.':partial?'Partial boundary; the exact extent is unknown.':'One-based inclusive coordinates.'};
}
export function parseGenbank(input,{file=''}={}){
  if(typeof input!=='string'||new TextEncoder().encode(input).length>sequenceLimits.fileBytes)fail('input exceeds 5 MiB.');
  const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),blocks=[];let block=[];
  for(const line of lines){if(!block.length&&!line.trim())continue;if(!block.length&&!line.startsWith('LOCUS '))fail('each record must start with LOCUS.');block.push(line);if(line.trim()==='//'){blocks.push(block);block=[];}}
  if(block.length)fail('record is missing its // terminator.');if(!blocks.length||blocks.length>sequenceLimits.records)fail('use 1–100 records.');
  const records=blocks.map(rows=>{
    const locus=rows[0].match(/^LOCUS\s+(\S+)\s+(\d+)\s+(bp|aa)\b(.*)$/i);if(!locus)fail('LOCUS must include an identifier, sequence length and bp/aa units.');
    const [,name,declared,unit,rest]=locus;
    if(unit.toLowerCase()==='bp'&&!/DNA|RNA/i.test(rest))fail('LOCUS must declare DNA or RNA; the molecule type is not inferred from letters.');
    const alphabet=unit.toLowerCase()==='aa'?'protein':/RNA/i.test(rest)?'RNA':'DNA',topology=/\bcircular\b/i.test(rest)?'circular':'linear';
    const origin=rows.findIndex(l=>/^ORIGIN\b/.test(l));if(origin<0||rows.slice(origin+1,-1).some(l=>!/^[\sa-zA-Z0-9*]*$/.test(l)))fail('ORIGIN sequence is missing or contains invalid characters. CONTIG-only records are not supported.');
    const sequenceText=rows.slice(origin+1,-1).join('').replace(/[\s0-9]/g,'').toUpperCase();
    // GenBank convention uses T even for mRNA; the RNA document uses U.
    const sequence=validateSequence(alphabet==='RNA'?sequenceText.replace(/T/g,'U'):sequenceText,alphabet);if(Number(declared)!==sequence.length)fail(`${name}: LOCUS length ${declared} differs from ORIGIN length ${sequence.length}.`);
    const fields={};let field='';for(const line of rows.slice(1,origin)){
      if(/^FEATURES\b/.test(line))break;
      const key=line.slice(0,12).trim();if(key){field=key;fields[field]=(fields[field]?fields[field]+' ':'')+line.slice(12).trim();}else if(field)fields[field]+=' '+line.slice(12).trim();
    }
    const decodeQuoted=value=>{let decoded='';for(let i=0;i<value.length;i++){if(value[i]!=='"'){decoded+=value[i];continue;}if(value[i+1]==='"'){decoded+='"';i++;continue;}if(value.slice(i+1).trim())fail('text after a closing qualifier quote.');return {value:decoded,open:false};}return {value:decoded,open:true};};
    const features=[],featureStart=rows.findIndex(l=>/^FEATURES\b/.test(l));let current=null,locationMode=true,qualifier=null,quoted=false;
    const flushQualifier=()=>{if(!qualifier)return;if(quoted)fail('unterminated quoted feature qualifier.');current.qualifiers.push(qualifier);qualifier=null;};
    for(const line of featureStart<0?[]:rows.slice(featureStart+1,origin)){
      if(!line.trim())continue;const key=line.slice(5,21).trim(),content=line.slice(21).trim();
      if(key){flushQualifier();current={key,location:content,qualifiers:[]};features.push(current);locationMode=true;continue;}
      if(!current)fail('feature continuation without a feature key.');
      if(quoted){const piece=decodeQuoted(content);qualifier.value+=(qualifier.name==='translation'?'':' ')+piece.value;quoted=piece.open;continue;}
      if(content.startsWith('/')){
        flushQualifier();locationMode=false;const q=content.match(/^\/([-A-Za-z0-9_'*]+)(?:=(.*))?$/);if(!q)fail('malformed feature qualifier.');
        let val=q[2]??null;if(val?.startsWith('"')){const piece=decodeQuoted(val.slice(1));val=piece.value;quoted=piece.open;}qualifier={name:q[1],value:val};
      }else if(locationMode)current.location+=content;
      else if(qualifier&&qualifier.value!==null)qualifier.value+=(qualifier.name==='translation'?'':' ')+content;
      else fail('unexpected feature continuation.');
    }
    flushQualifier();for(const f of features)featureLocation(f.location,sequence.length,topology);
    return makeSequence({name,description:fields.DEFINITION??'',alphabet,sequence,source:{format:'genbank',file},genbank:{locus:name,accession:fields.ACCESSION??'',version:fields.VERSION?.split(/\s+/)[0]??'',definition:fields.DEFINITION??'',organism:fields.ORGANISM??'',topology,features,raw:rows.join('\n')+'\n'}});
  });
  return readSequenceWorkspace({version:1,records,activeId:records[0].id}).records;
}
const wrap=(prefix,value,width=79)=>{const lines=[];let rest=String(value);const n=width-prefix.length;while(rest.length>n){let at=rest.lastIndexOf(' ',n);if(at<1)at=n;lines.push(prefix+rest.slice(0,at));rest=rest.slice(at).trimStart();prefix=' '.repeat(prefix.length);}lines.push(prefix+rest);return lines.join('\n');};
export function genbankFor(records){
  return records.map(raw=>{
    const r=readSequenceRecord(raw),g=r.genbank,unit=r.alphabet==='protein'?'aa':'bp',molecule=r.alphabet==='protein'?'':r.alphabet==='DNA'?'DNA':'RNA',locus=r.name.replace(/[^A-Za-z0-9_.-]/g,'_');
    const now=new Date(),date=g?.raw.split('\n')[0].match(/\b\d{2}-[A-Z]{3}-\d{4}\s*$/)?.[0].trim()??`${String(now.getUTCDate()).padStart(2,'0')}-${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getUTCMonth()]}-${now.getUTCFullYear()}`;
    const header=`LOCUS       ${locus.padEnd(16)} ${String(r.sequence.length).padStart(11)} ${unit}    ${molecule.padEnd(6)}  ${(g?.topology??'linear').padEnd(8)} UNK ${date}`;
    const lines=[header,wrap('DEFINITION  ',r.description||'.'),`ACCESSION   ${g?.accession||locus}`,`VERSION     ${g?.version||locus}`,wrap('COMMENT     ','Educational export. LOCUS preserves the imported date when available; otherwise it uses the UTC export date. The original imported text and conversion settings are retained in the sequence workspace JSON.')];
    if(g?.organism)lines.push(wrap('  ORGANISM  ',g.organism));
    if(r.provenance)lines.push(wrap('COMMENT     ',`Derived by ${r.provenance.operation} from ${r.provenance.inputName}; input SHA256 ${r.provenance.inputSha256}. Source annotations were not copied.`));
    lines.push('FEATURES             Location/Qualifiers');
    for(const f of g?.features??[]){featureLocation(f.location,r.sequence.length,g.topology);lines.push(wrap('     '+f.key.padEnd(16),f.location));for(const q of f.qualifiers){const val=q.value===null?'':`="${q.value.replaceAll('"','""').replace(/[\r\n]+/g,' ')}"`;lines.push(wrap('                     ',`/${q.name}${val}`));}}
    lines.push('ORIGIN');const sequence=r.alphabet==='RNA'?r.sequence.replace(/U/g,'T'):r.sequence;
    for(let offset=0;offset<sequence.length;offset+=60)lines.push(`${String(offset+1).padStart(9)} ${sequence.slice(offset,offset+60).toLowerCase().match(/.{1,10}/g).join(' ')}`);
    lines.push('//');return lines.join('\n')+'\n';
  }).join('');
}
