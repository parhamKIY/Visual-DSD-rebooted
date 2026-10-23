// Pure, bounded experiment data. No eval, source rewriting or dependency on the UI.
const fail = message => { throw new Error(`Logic experiment: ${message}`); };
const str = (x, max=4096) => typeof x === 'string' && x.length <= max ? x : fail('invalid text.');
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : fail('enter finite numbers.');
const list = (x, max) => Array.isArray(x) && x.length <= max ? x : fail('missing or oversized list.');
const copy = x => JSON.parse(JSON.stringify(x));
export const CASE_STATES = ['queued','admitting','running','succeeded','failed','timedOut','cancelled','interrupted'];

export function booleanFunction(expression, names) {
  str(expression,512);
  const tokens = expression.match(/[A-Za-z_][A-Za-z_0-9]*|[01!~&|^()]|\S/g) ?? [];
  if (tokens.length > 256) fail('Boolean expression is too large.');
  let pos=0, depth=0;
  const peek = (...values) => values.includes(tokens[pos]?.toUpperCase());
  const atom = () => {
    if (++depth>32) fail('Boolean expression is nested too deeply.');
    let node;
    if (peek('!','~','NOT')) { pos++; node=['not',atom()]; }
    else if (peek('(')) { pos++; node=or(); if(!peek(')'))fail('missing closing parenthesis.'); pos++; }
    else { const name=tokens[pos++]; if(name==='0'||name==='1')node=['literal',name==='1']; else if(names.includes(name))node=['input',name]; else fail(`unknown input ${name??'(empty expression)'}.`); }
    depth--; return node;
  };
  const chain = (next, operators, kind) => () => { let node=next(); while(peek(...operators)){pos++;node=[kind,node,next()];} return node; };
  const and=chain(atom,['&','AND'],'and'), xor=chain(and,['^','XOR'],'xor'), or=chain(xor,['|','OR'],'or');
  const tree=or(); if(pos!==tokens.length)fail(`unexpected token ${tokens[pos]}. Use NOT, AND, XOR, OR and parentheses.`);
  const evaluate=(node,values)=>node[0]==='literal'?node[1]:node[0]==='input'?Boolean(values[node[1]]):node[0]==='not'?!evaluate(node[1],values):node[0]==='and'?evaluate(node[1],values)&&evaluate(node[2],values):node[0]==='or'?evaluate(node[1],values)||evaluate(node[2],values):evaluate(node[1],values)!==evaluate(node[2],values);
  return values=>Number(evaluate(tree,values));
}

export function defaultLogicConfig() {
  return {title:'My logic circuit',provenance:'',inputs:[{name:'A',one:'',zero:'',off:0,on:1},{name:'B',one:'',zero:'',off:0,on:1}],outputs:[{name:'Y',one:'',zero:'',expression:'A OR B'}],low:.2,high:.8,time:100,final:100,points:200,timeout:30,unit:'nM',timeUnit:'s'};
}
export function readLogicConfig(raw, strict=false) {
  if(!raw||typeof raw!=='object')fail('missing configuration.');
  const c={title:str(raw.title,120),provenance:str(raw.provenance,2048),inputs:list(raw.inputs,4).map(i=>({name:str(i.name,32),one:str(i.one),zero:str(i.zero),off:num(i.off),on:num(i.on)})),outputs:list(raw.outputs,4).map(o=>({name:str(o.name,32),one:str(o.one),zero:str(o.zero),expression:str(o.expression,512)}))};
  for(const k of ['low','high','time','final','points','timeout'])c[k]=num(raw[k]);
  for(const k of ['unit','timeUnit'])c[k]=str(raw[k],32);
  if(!c.inputs.length||!c.outputs.length)fail('configure 1–4 logical inputs and 1–4 outputs (at most 16 cases).');
  for(const items of [c.inputs,c.outputs])if(new Set(items.map(i=>i.name)).size!==items.length||items.some(i=>!/^[A-Za-z_][A-Za-z_0-9]*$/.test(i.name)||/^(AND|OR|NOT|XOR|true|false)$/i.test(i.name)))fail('use distinct simple names such as A, B and Y.');
  if(c.inputs.some(i=>i.off<0||i.on<=i.off))fail('each ON concentration must exceed its nonnegative OFF concentration.');
  if(c.low<0||c.high<=c.low)fail('the high threshold must exceed the nonnegative low threshold.');
  if(c.time<=0||c.final<c.time||!Number.isInteger(c.points)||c.points<1||c.points>500||!Number.isInteger(c.timeout)||c.timeout<1||c.timeout>120)fail('read time > 0, final time ≥ read time, 1–500 points and 1–120 seconds per case are required.');
  if(strict){
    c.outputs.forEach(o=>booleanFunction(o.expression,c.inputs.map(i=>i.name)));
    if(!c.unit||!c.timeUnit||[...c.inputs,...c.outputs].some(i=>!i.one))fail('map every input and output to a molecule, and confirm the source units.');
    const inputs=c.inputs.flatMap(i=>[i.one,...(i.zero?[i.zero]:[])]),outputs=c.outputs.flatMap(i=>[i.one,...(i.zero?[i.zero]:[])]);
    if(new Set(inputs).size!==inputs.length||new Set(outputs).size!==outputs.length)fail('each physical input rail and output rail must have a distinct molecular structure.');
  }
  return c;
}
export function truthCases(config) {
  const c=readLogicConfig(config,true),functions=c.outputs.map(o=>booleanFunction(o.expression,c.inputs.map(i=>i.name)));
  return Array.from({length:2**c.inputs.length},(_,index)=>{
    const bits=c.inputs.map((_,i)=>(index>>(c.inputs.length-i-1))&1),values=Object.fromEntries(c.inputs.map((i,n)=>[i.name,bits[n]]));
    return {bits,expected:functions.map(fn=>fn(values)),state:'queued'};
  });
}
export function readLogicCase(raw) {
  const inputs=list(raw?.inputs,8).map(i=>({structure:str(i.structure),value:num(i.value)})),outputs=list(raw?.outputs,8).map(s=>str(s));
  if(!inputs.length||!outputs.length||inputs.some(i=>!i.structure||i.value<0)||outputs.some(s=>!s)||new Set(inputs.map(i=>i.structure)).size!==inputs.length||new Set(outputs).size!==outputs.length)fail('invalid physical rail mapping.');
  return {inputs,outputs};
}
export function caseRequest(base, config, bits) {
  const c=readLogicConfig(config,true);
  if(bits.length!==c.inputs.length||bits.some(b=>b!==0&&b!==1))fail('invalid input case.');
  const inputs=c.inputs.flatMap((i,n)=>[{structure:i.one,value:bits[n]?i.on:i.off},...(i.zero?[{structure:i.zero,value:bits[n]?i.off:i.on}]:[])]);
  return {...copy(base),operation:'simulate',simulator:'oslo',initial:0,final:c.final,points:c.points,timeoutSeconds:c.timeout,logicCase:readLogicCase({inputs,outputs:c.outputs.flatMap(o=>[o.one,...(o.zero?[o.zero]:[])])})};
}
export function sampleAt(curve, time) {
  const {times,series}=curve;
  if(!times.length||time<times[0]||time>times.at(-1))fail('read time lies outside the completed trajectory.');
  let right=times.findIndex(t=>t>=time);
  // At an exact duplicate time, use the last returned sample at that time.
  while(right+1<times.length&&times[right+1]===time)right++;
  const left=right===0||times[right]===time?right:right-1,weight=left===right?0:(time-times[left])/(times[right]-times[left]);
  return series.map(s=>s.values[left]+weight*(s.values[right]-s.values[left]));
}
export function readout(config, row) {
  if(row.state!=='succeeded'||!row.curve)return {status:row.state,outputs:[]};
  const values=sampleAt(row.curve,config.time); let cursor=0;
  const classify=v=>v<=config.low?0:v>=config.high?1:null;
  const outputs=config.outputs.map((o,index)=>{
    const one=values[cursor++],zero=o.zero?values[cursor++]:null;
    const a=classify(one),b=zero===null?null:classify(zero),observed=zero===null?a:a===1&&b===0?1:a===0&&b===1?0:null;
    return {one,zero,expected:row.expected[index],observed,status:observed===null?'unknown':observed===row.expected[index]?'correct':'incorrect'};
  });
  return {status:outputs.some(o=>o.status==='incorrect')?'incorrect':outputs.some(o=>o.status==='unknown')?'unknown':'correct',outputs};
}
export function collectLogicCurve(response, request, config) {
  if(!response.success)fail(response.diagnostics?.map(d=>d.message).join('\n')||'simulation failed.');
  const model=response.model,run=model.simulations[0];
  if(model.simulations.length!==1||!run||run.spatial||run.probabilities||run.sweep||run.assignment)fail('expected one deterministic run without sweeps.');
  const settings=run.settings??model.settings;
  if(settings.concentrationUnit!==config.unit||settings.timeUnit!==config.timeUnit)fail('source units differ from the confirmed experiment units.');
  const species=run.network?.species??model.species;
  const series=request.logicCase.outputs.map(structure=>{
    const candidates=species.filter(s=>!s.sourceId&&s.structure===structure);
    if(candidates.length!==1)fail('output structure is missing or ambiguous.');
    const s=candidates[0],columns=run.series.filter(column=>[s.id,s.name,structure].includes(column.name));
    if(columns.length!==1)fail(`cannot identify output curve for ${structure}.`);
    return {name:structure,values:[...columns[0].values]};
  });
  const curve=readCurve({times:run.times,series,timeUnit:settings.timeUnit,concentrationUnit:settings.concentrationUnit});
  sampleAt(curve,config.time);return curve;
}
function readCurve(raw) {
  const times=list(raw.times,10000).map(num),series=list(raw.series,8).map(s=>({name:str(s.name),values:list(s.values,10000).map(num)}));
  if(times.some((t,i)=>i&&t<times[i-1])||!times.length||!series.length||series.some(s=>s.values.length!==times.length))fail('invalid trajectory.');
  return {times,series,timeUnit:str(raw.timeUnit,32),concentrationUnit:str(raw.concentrationUnit,32)};
}
export function readLogicState(raw) {
  if(raw==null)return undefined;
  if(raw.version!==1)fail('unknown experiment version.');
  const result={version:1,config:readLogicConfig(raw.config)};
  if(raw.batch!=null){
    const b=raw.batch,c=readLogicConfig(b.config,true),expected=truthCases(c);
    const request=copy(b.request);
    if(!request||typeof request.code!=='string'||new TextEncoder().encode(request.code).length>256*1024||request.operation!=='simulate'||request.logicCase!=null)fail('invalid source snapshot.');
    const cases=list(b.cases,16).map((r,index)=>{
      if(!expected[index]||JSON.stringify(r.bits)!==JSON.stringify(expected[index].bits)||JSON.stringify(r.expected)!==JSON.stringify(expected[index].expected)||!CASE_STATES.includes(r.state))fail('case does not match the Boolean function.');
      const row={...expected[index],state:r.state};
      if(r.jobId!=null){if(!/^[a-f0-9]{32}$/i.test(r.jobId))fail('invalid job identifier.');row.jobId=r.jobId;}
      if(r.message!=null)row.message=str(r.message,4096);
      if(r.curve!=null){row.curve=readCurve(r.curve);const outputs=caseRequest(request,c,row.bits).logicCase.outputs;if(JSON.stringify(row.curve.series.map(s=>s.name))!==JSON.stringify(outputs)||row.curve.timeUnit!==c.timeUnit||row.curve.concentrationUnit!==c.unit)fail('trajectory mapping or units differ from the snapshot.');sampleAt(row.curve,c.time);}
      if((row.state==='succeeded')!==Boolean(row.curve))fail('completed case must include its trajectory.');
      if(row.state==='running'&&!row.jobId)fail('running case has no admitted job.');
      return row;
    });
    if(cases.length!==expected.length||!Number.isFinite(Date.parse(b.createdAt)))fail('incomplete case list or invalid timestamp.');
    result.batch={id:str(b.id,80),createdAt:b.createdAt,engineVersion:str(b.engineVersion,64),request,config:c,cases};
  }
  return result;
}
export function newLogicBatch(base, config, engineVersion) {
  const c=readLogicConfig(config,true);
  return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),engineVersion,request:copy(base),config:c,cases:truthCases(c)};
}
export function logicIsCurrent(base, config, batch) {
  return Boolean(batch&&JSON.stringify(base)===JSON.stringify(batch.request)&&JSON.stringify(readLogicConfig(config))===JSON.stringify(batch.config));
}
export function logicCsv(batch) {
  const cell=x=>`"${String(x??'').replace(/"/g,'""')}"`;
  const headers=[...batch.config.inputs.map(i=>i.name),...batch.config.outputs.flatMap(o=>[o.name+' expected',o.name+' observed',o.name+' rail 1 ('+batch.config.unit+')',...(o.zero?[o.name+' rail 0 ('+batch.config.unit+')']:[]),o.name+' status']),'Case status','Job','Diagnostic'];
  return [headers,...batch.cases.map(row=>{const r=readout(batch.config,row);return [...row.bits,...batch.config.outputs.flatMap((o,i)=>[row.expected[i],r.outputs[i]?.observed??'',r.outputs[i]?.one??'',...(o.zero?[r.outputs[i]?.zero??'']:[]),r.outputs[i]?.status??'']),r.status,row.jobId??'',row.message??''];})].map(row=>row.map(cell).join(',')).join('\r\n');
}
