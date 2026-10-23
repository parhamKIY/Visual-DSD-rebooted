// Pure, bounded experiment data. No eval, source rewriting or dependency on the UI.
const fail = message => { throw new Error(`Logic experiment: ${message}`); };
const str = (x, max=4096) => typeof x === 'string' && x.length <= max ? x : fail('invalid text.');
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : fail('enter finite numbers.');
const list = (x, max) => Array.isArray(x) && x.length <= max ? x : fail('missing or oversized list.');
const copy = x => JSON.parse(JSON.stringify(x));
export const CASE_STATES = ['queued','admitting','running','succeeded','failed','timedOut','cancelled','interrupted'];

export function booleanTree(expression, names) {
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
  return tree;
}
export function booleanValue(node,values){
  return node[0]==='literal'?Number(node[1]):node[0]==='input'?Number(Boolean(values[node[1]])):node[0]==='not'?1-booleanValue(node[1],values):node[0]==='and'?Number(Boolean(booleanValue(node[1],values)&&booleanValue(node[2],values))):node[0]==='or'?Number(Boolean(booleanValue(node[1],values)||booleanValue(node[2],values))):Number(booleanValue(node[1],values)!==booleanValue(node[2],values));
}
export function booleanFunction(expression,names){
  const tree=booleanTree(expression,names);return values=>booleanValue(tree,values);
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
  const inputs=list(raw?.inputs,8).map(i=>({structure:str(i.structure),value:num(i.value)})),outputs=list(raw?.outputs,16).map(s=>str(s));
  if(!inputs.length||!outputs.length||inputs.some(i=>!i.structure||i.value<0)||outputs.some(s=>!s)||new Set(inputs.map(i=>i.structure)).size!==inputs.length||new Set(outputs).size!==outputs.length)fail('invalid physical rail mapping.');
  const result={inputs,outputs};
  if(raw.parameters!=null)result.parameters=readLogicParameters(raw.parameters);
  return result;
}
export function readLogicParameters(raw){
  const parameters=list(raw,8).map(p=>({name:str(p.name,128),value:num(p.value)}));
  if(parameters.some(p=>!/^[A-Za-z_][A-Za-z_0-9.]*$/.test(p.name))||new Set(parameters.map(p=>p.name)).size!==parameters.length)fail('use distinct declared parameter names.');
  return parameters;
}
export function readLogicExecution(raw){
  if(!raw||!['oslo','ssa'].includes(raw.simulator))fail('choose deterministic Oslo or seeded SSA.');
  const seed=raw.simulator==='ssa'?num(raw.seed):null;
  if(seed!==null&&(!Number.isInteger(seed)||seed<0||seed>2147483632))fail('SSA seed must be an integer between 0 and 2147483632.');
  return {simulator:raw.simulator,seed,parameters:readLogicParameters(raw.parameters??[])};
}
export function logicPlots(config,traceInputs=false){
  return [...new Set([...config.outputs,...(traceInputs?config.inputs:[])].flatMap(o=>[o.one,...(o.zero?[o.zero]:[])]))];
}
export function caseRequest(base, config, bits, {traceInputs=false,execution=null}={}) {
  const c=readLogicConfig(config,true);
  if(bits.length!==c.inputs.length||bits.some(b=>b!==0&&b!==1))fail('invalid input case.');
  const inputs=c.inputs.flatMap((i,n)=>[{structure:i.one,value:bits[n]?i.on:i.off},...(i.zero?[{structure:i.zero,value:bits[n]?i.off:i.on}]:[])]);
  const run=execution?readLogicExecution(execution):null,index=bits.reduce((value,bit)=>value*2+bit,0);
  return {...copy(base),operation:'simulate',simulator:run?.simulator??'oslo',...(run?.simulator==='ssa'?{seed:run.seed+index}:{}),initial:0,final:c.final,points:c.points,timeoutSeconds:c.timeout,logicCase:readLogicCase({inputs,outputs:logicPlots(c,traceInputs),...(run?.parameters.length?{parameters:run.parameters}:{})})};
}
export function sampleAt(curve, time) {
  const {times,series}=curve;
  if(!times.length||time<times[0]||time>times.at(-1))fail('read time lies outside the completed trajectory.');
  let right=times.findIndex(t=>t>=time);
  // At an exact duplicate time, use the last returned sample at that time.
  while(right+1<times.length&&times[right+1]===time)right++;
  const left=right===0||times[right]===time?right:right-1,weight=left===right?0:(time-times[left])/(times[right]-times[left]);
  return series.map(s=>left===right||curve.mode==='step'?s.values[left]:(1-weight)*s.values[left]+weight*s.values[right]);
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
  if(request.simulator==='ssa'&&(settings.simulator!=='ssa'||run.seed!==request.seed))fail('SSA solver or returned seed differs from the recorded request.');
  const curve=readCurve({times:run.times,series,timeUnit:settings.timeUnit,concentrationUnit:settings.concentrationUnit,...(request.simulator==='ssa'?{mode:'step'}:{})});
  sampleAt(curve,config.time);return curve;
}
function readCurve(raw) {
  const times=list(raw.times,10000).map(num),series=list(raw.series,16).map(s=>({name:str(s.name),values:list(s.values,10000).map(num)}));
  if(times.some((t,i)=>i&&t<times[i-1])||!times.length||!series.length||series.some(s=>s.values.length!==times.length))fail('invalid trajectory.');
  if(raw.mode!==undefined&&raw.mode!=='step')fail('unknown trajectory interpolation mode.');
  return {times,series,timeUnit:str(raw.timeUnit,32),concentrationUnit:str(raw.concentrationUnit,32),...(raw.mode?{mode:raw.mode}:{})};
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
      if(r.curve!=null){row.curve=readCurve(r.curve);const outputs=logicPlots(c,b.traceInputs===true);if(JSON.stringify(row.curve.series.map(s=>s.name))!==JSON.stringify(outputs)||row.curve.timeUnit!==c.timeUnit||row.curve.concentrationUnit!==c.unit)fail('trajectory mapping or units differ from the snapshot.');sampleAt(row.curve,c.time);}
      if((row.state==='succeeded')!==Boolean(row.curve))fail('completed case must include its trajectory.');
      if(row.state==='running'&&!row.jobId)fail('running case has no admitted job.');
      return row;
    });
    if(cases.length!==expected.length||!Number.isFinite(Date.parse(b.createdAt)))fail('incomplete case list or invalid timestamp.');
    result.batch={id:str(b.id,80),createdAt:b.createdAt,engineVersion:str(b.engineVersion,64),request,config:c,cases};
    if(b.traceInputs!==undefined){if(typeof b.traceInputs!=='boolean')fail('invalid input trace flag.');result.batch.traceInputs=b.traceInputs;}
    if(b.molecules!=null)result.batch.molecules=readLogicMolecules(b.molecules,logicPlots(c,b.traceInputs===true));
    if(b.analysis!=null)result.batch.analysis=readAnalysisWindow(b.analysis,c);
    if(b.execution!=null){result.batch.execution=readLogicExecution(b.execution);for(const row of cases)if(row.curve&&(row.curve.mode==='step')!==(b.execution.simulator==='ssa'))fail('trajectory interpolation differs from the recorded solver.');}
    else if(cases.some(row=>row.curve?.mode==='step'))fail('stochastic trajectories require recorded execution settings.');
  }
  if(raw.studyPlan!=null)result.studyPlan=readStudyPlan(raw.studyPlan,result.config);
  if(raw.study!=null)result.study=readStudy(raw.study);
  if(raw.report!=null)result.report=readLogicReport(raw.report);
  return result;
}
export function newLogicBatch(base, config, engineVersion,{traceInputs=false,execution=null}={}) {
  const c=readLogicConfig(config,true);
  return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),engineVersion,request:copy(base),config:c,cases:truthCases(c),...(traceInputs?{traceInputs:true}:{}),...(execution?{execution:readLogicExecution(execution)}:{})};
}
export function readLogicReport(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid student interpretation.');return {student:str(raw.student??'',120),question:str(raw.question??'',4000),interpretation:str(raw.interpretation??'',12000),limitations:str(raw.limitations??'',4000)};}
export function defaultStudyPlan(){return {simulator:'oslo',repeats:1,seed:1234,variants:[{label:'Reference',onFactor:1,offFactor:1,parameters:[]},{label:'Lower input',onFactor:.8,offFactor:1,parameters:[]}]};}
export function variantConfig(config,variant){return readLogicConfig({...copy(config),inputs:config.inputs.map(i=>({...i,on:i.on*variant.onFactor,off:i.off*variant.offFactor}))},true);}
export function readStudyPlan(raw,config){
  if(!raw||!['oslo','ssa'].includes(raw.simulator)||!Number.isInteger(raw.repeats)||raw.repeats<1||raw.repeats>8||raw.simulator==='oslo'&&raw.repeats!==1)fail('use one deterministic run or 1–8 SSA repeats.');
  if(!Number.isInteger(raw.seed)||raw.seed<0||raw.seed>2147483519)fail('study seed must be an integer from 0 to 2147483519.');
  const variants=list(raw.variants,4).map(v=>({label:str(v.label,80),onFactor:num(v.onFactor),offFactor:num(v.offFactor),parameters:readLogicParameters(v.parameters??[])}));
  if(!variants.length||new Set(variants.map(v=>v.label)).size!==variants.length||variants.some(v=>!v.label.trim()||v.onFactor<=0||v.offFactor<0))fail('use 1–4 distinct variant labels, positive ON factors and nonnegative OFF factors.');
  if(variants.length*raw.repeats*2**config.inputs.length>64)fail('a comparison is limited to 64 case simulations; reduce variants or repeats.');
  for(const v of variants)if(config.inputs.every(i=>i.one)&&config.outputs.every(o=>o.one))variantConfig(config,v);
  return {simulator:raw.simulator,repeats:raw.repeats,seed:raw.seed,variants};
}
function readStudy(raw){
  const config=readLogicConfig(raw.config,true),plan=readStudyPlan(raw.plan,config),request=copy(raw.request),count=plan.variants.length*plan.repeats;
  const batches=list(raw.batches,32).map((b,index)=>{
    const variant=plan.variants[Math.floor(index/plan.repeats)];if(!variant)fail('unexpected study batch.');
    const c=variantConfig(config,variant),batch=readLogicState({version:1,config:c,batch:b}).batch;
    const execution={simulator:plan.simulator,seed:plan.simulator==='ssa'?plan.seed+(index%plan.repeats)*16:null,parameters:variant.parameters};
    if(JSON.stringify(batch.request)!==JSON.stringify(request)||JSON.stringify(batch.config)!==JSON.stringify(c)||JSON.stringify(batch.execution)!==JSON.stringify(execution)||batch.engineVersion!==raw.engineVersion||batch.traceInputs!==true)fail('comparison batch differs from its recorded plan.');
    return batch;
  });
  if(batches.length!==count||!Number.isFinite(Date.parse(raw.createdAt)))fail('incomplete comparison or invalid timestamp.');
  return {id:str(raw.id,80),createdAt:raw.createdAt,engineVersion:str(raw.engineVersion,64),request,config,plan,batches};
}
export function readAnalysisWindow(raw,config){
  const start=num(raw.start),end=num(raw.end);
  if(start<0||end<=start||end>config.final)fail('analysis window must satisfy 0 ≤ start < end ≤ simulation final time.');
  return {start,end};
}
function readLogicMolecules(raw,allowed){
  const molecules=list(raw,16).map(m=>({structure:str(m.structure),name:str(m.name,512),svg:str(m.svg,256*1024)}));
  if(molecules.some(m=>!allowed.includes(m.structure))||new Set(molecules.map(m=>m.structure)).size!==molecules.length)fail('molecular preview differs from the recorded mapping.');
  return molecules;
}
export function collectLogicMolecules(response,request){
  const species=response.model.simulations[0]?.network?.species??response.model.species;
  return readLogicMolecules(request.logicCase.outputs.map(structure=>{
    const matches=species.filter(s=>!s.sourceId&&s.structure===structure);
    if(matches.length!==1)fail('molecular preview is missing or ambiguous.');
    return {structure,name:matches[0].name,svg:matches[0].svg??''};
  }),request.logicCase.outputs);
}
export function logicIsCurrent(base, config, batch) {
  return Boolean(batch&&JSON.stringify(base)===JSON.stringify(batch.request)&&JSON.stringify(readLogicConfig(config))===JSON.stringify(batch.config));
}
export function logicCsv(batch) {
  const cell=x=>`"${String(x??'').replace(/"/g,'""')}"`;
  const headers=[...batch.config.inputs.map(i=>i.name),...batch.config.outputs.flatMap(o=>[o.name+' expected',o.name+' observed',o.name+' rail 1 ('+batch.config.unit+')',...(o.zero?[o.name+' rail 0 ('+batch.config.unit+')']:[]),o.name+' status']),'Case status','Job','Diagnostic'];
  return [headers,...batch.cases.map(row=>{const r=readout(batch.config,row);return [...row.bits,...batch.config.outputs.flatMap((o,i)=>[row.expected[i],r.outputs[i]?.observed??'',r.outputs[i]?.one??'',...(o.zero?[r.outputs[i]?.zero??'']:[]),r.outputs[i]?.status??'']),r.status,row.jobId??'',row.message??''];})].map(row=>row.map(cell).join(',')).join('\r\n');
}
