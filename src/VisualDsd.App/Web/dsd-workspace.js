export const dsdFields = Object.freeze([
  {
    "name": "leaks",
    "id": "dsdLeaks",
    "label": "Leak reactions",
    "kind": "bool"
  },
  {
    "name": "pinLeaks",
    "id": "dsdPinLeaks",
    "label": "Pin leak reactions",
    "kind": "bool"
  },
  {
    "name": "polymers",
    "id": "dsdPolymers",
    "label": "Allow polymers",
    "kind": "bool"
  },
  {
    "name": "unproductive",
    "id": "dsdUnproductive",
    "label": "Unproductive reactions",
    "kind": "bool"
  },
  {
    "name": "sequenceRates",
    "id": "dsdSequenceRates",
    "label": "Sequence-based rates",
    "kind": "bool"
  },
  {
    "name": "declareDomains",
    "id": "dsdDeclareDomains",
    "label": "Require declared domains",
    "kind": "bool"
  },
  {
    "name": "checkDna",
    "id": "dsdCheckDna",
    "label": "Check DNA databases",
    "kind": "bool"
  },
  {
    "name": "colourToeholds",
    "id": "dsdColourToeholds",
    "label": "Colour toeholds",
    "kind": "bool"
  },
  {
    "name": "plotNames",
    "id": "dsdPlotNames",
    "label": "Plot species names",
    "kind": "bool"
  },
  {
    "name": "stateImages",
    "id": "dsdStateImages",
    "label": "State images",
    "kind": "bool"
  },
  {
    "name": "jit",
    "id": "dsdJit",
    "label": "Just-in-time expansion",
    "kind": "bool"
  },
  {
    "name": "toeholdBindRate",
    "id": "dsdToeholdBindRate",
    "label": "Default toehold binding rate",
    "kind": "double"
  },
  {
    "name": "toeholdUnbindRate",
    "id": "dsdToeholdUnbindRate",
    "label": "Default toehold unbinding rate",
    "kind": "double"
  },
  {
    "name": "toeholdLength",
    "id": "dsdToeholdLength",
    "label": "Toehold length",
    "kind": "int"
  },
  {
    "name": "specificityLength",
    "id": "dsdSpecificityLength",
    "label": "Specificity length",
    "kind": "int"
  },
  {
    "name": "temperature",
    "id": "dsdTemperature",
    "label": "Temperature (C)",
    "kind": "double"
  },
  {
    "name": "predicates",
    "id": "dsdPredicates",
    "label": "Generated predicates",
    "kind": "string",
    "choices": [
      "all",
      "none"
    ]
  },
  {
    "name": "renderer",
    "id": "dsdRenderer",
    "label": "Molecular renderer",
    "kind": "string",
    "choices": [
      "classic",
      "circles",
      "branches"
    ]
  },
  {
    "name": "renderMode",
    "id": "dsdRenderMode",
    "label": "Domain display",
    "kind": "string",
    "choices": [
      "complement",
      "condensed",
      "nucleotides"
    ]
  },
  {
    "name": "arrange",
    "id": "dsdArrange",
    "label": "Branch arrangement",
    "kind": "string",
    "choices": [
      "wide",
      "babylon"
    ]
  },
  {
    "name": "rotateLabels",
    "id": "dsdRotateLabels",
    "label": "Rotate domain labels",
    "kind": "bool"
  }
]);

export const dsdDefaults = Object.freeze(Object.fromEntries(dsdFields.map(field=>[field.id,''])));
export function readDsdOptions(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('Invalid DSD options.');
  if(Object.keys(raw).some(key=>!dsdFields.some(field=>field.name===key)))throw new Error('Unknown DSD option.');
  const result={};
  for(const field of dsdFields){
    const value=raw[field.name];if(value==null)continue;
    if(field.kind==='bool') {if(typeof value!=='boolean')throw new Error(`${field.label}: choose true or false.`);}
    else if(field.kind==='string'){if(!field.choices.includes(value))throw new Error(`${field.label}: unknown choice.`);}
    else{
      if(typeof value!=='number' || !Number.isFinite(value))throw new Error(`${field.label}: enter a finite number.`);
      if(field.kind==='int' && (!Number.isInteger(value)||value<1||value>256))throw new Error(`${field.label}: use a whole number from 1 to 256.`);
      if(field.name==='temperature'?(value<=-273.15||value>1000):value<0)throw new Error(`${field.label}: value is outside its allowed range.`);
    }
    result[field.name]=value;
  }
  return result;
}
export function dsdOverrides(options){
  const raw={};
  for(const field of dsdFields){
    const text=(options[field.id]??'').trim();if(!text)continue;
    if(field.kind==='bool'){
      if(!['true','false'].includes(text))throw new Error(`${field.label}: choose from source, true or false.`);
      raw[field.name]=text==='true';
    }else raw[field.name]=field.kind==='string'?text:Number(text);
  }
  return readDsdOptions(raw);
}
export function readDsdWorkspace(raw){
  const fail=()=>{throw new Error('Invalid DSD workspace result.');};
  if(!raw || !['assigned','incomplete','unavailable'].includes(raw.sequenceStatus)||!Array.isArray(raw.sequences)||raw.sequences.length>10000)fail();
  const options=readDsdOptions(raw.options);if(dsdFields.some(f=>options[f.name]==null))fail();
  if(![raw.remainingToeholds,raw.remainingSpecificities].every(v=>Number.isInteger(v)&&v>=0&&v<=262144))fail();
  const names=new Set();
  const sequences=raw.sequences.map(entry=>{
    if(!entry||typeof entry.domain!=='string'||!entry.domain||entry.domain.length>512||names.has(entry.domain)||typeof entry.isToehold!=='boolean')fail();
    names.add(entry.domain);
    if(entry.sequence===null){if(entry.reverseComplement!==null)fail();}
    else if(typeof entry.sequence!=='string'||!entry.sequence||entry.sequence.length>262144||!/^[ACGT]+$/.test(entry.sequence)||reverseComplement(entry.sequence)!==entry.reverseComplement)fail();
    return {domain:entry.domain,isToehold:entry.isToehold,sequence:entry.sequence,reverseComplement:entry.reverseComplement};
  });
  if(raw.sequenceStatus==='unavailable' && sequences.length || raw.sequenceStatus==='assigned'&&sequences.some(s=>s.sequence===null) || raw.sequenceStatus==='incomplete'&&!sequences.some(s=>s.sequence===null))fail();
  return {options,sequenceStatus:raw.sequenceStatus,sequences,remainingToeholds:raw.remainingToeholds,remainingSpecificities:raw.remainingSpecificities};
}
export function reverseComplement(sequence){return [...sequence].reverse().map(base=>({A:'T',C:'G',G:'C',T:'A'})[base]).join('');}
export function databaseIssues(text,kind){
  const seen=new Set(),issues=[];let count=0;
  for(const [index,line]of text.split(/\r\n?|\n/).entries()){
    const sequence=line.trim();if(!sequence)continue;count++;
    if(!/^[ACGT]+$/.test(sequence))issues.push(`Line ${index+1}: use uppercase A, C, G and T only.`);
    if(kind==='toeholds'?sequence.length>=10:sequence.length<10)issues.push(`Line ${index+1}: ${kind==='toeholds'?'toeholds must be shorter than 10 bases':'specificities must have at least 10 bases'}.`);
    if(seen.has(sequence))issues.push(`Line ${index+1}: duplicate sequence.`);seen.add(sequence);
  }
  return {count,issues};
}
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
export function sequenceCsv(data){return [['Domain','Type','Sequence 5 to 3','Reverse complement 5 to 3'],...data.sequences.map(s=>[s.domain,s.isToehold?'toehold':'specificity',s.sequence??'unassigned',s.reverseComplement??'unassigned'])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function sequenceFasta(data){return data.sequences.filter(s=>s.sequence!==null).map((s,i)=>`>domain_${i+1} name=${s.domain.replace(/\s+/g,'_')} type=${s.isToehold?'toehold':'specificity'} orientation=5to3\n${s.sequence.match(/.{1,80}/g).join('\n')}\n>domain_${i+1}_reverse_complement orientation=5to3\n${s.reverseComplement.match(/.{1,80}/g).join('\n')}`).join('\n')+'\n';}
export function filterExamples(examples,query,category){
  const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return examples.filter(example=>(!category||example.category===category)&&words.every(word=>[example.name,example.description,example.category??'Workspace',example.source??''].join(' ').toLocaleLowerCase().includes(word)));
}
