import { booleanTree, booleanValue, readLogicConfig, readAnalysisWindow, sampleAt, readout } from './logic.js';

export function logicSignals(config){
  return ['inputs','outputs'].flatMap(kind=>config[kind].map((item,index)=>({key:`${kind}:${item.name}`,kind,name:item.name,index,rails:[{structure:item.one,rail:1},...(item.zero?[{structure:item.zero,rail:0}]:[])]})));
}

// This is the entered Boolean function, not an inferred molecular reaction graph.
export function logicGraph(config,bits){
  const c=readLogicConfig(config,true),values=bits?Object.fromEntries(c.inputs.map((i,n)=>[i.name,bits[n]])):null;
  if(bits&&(bits.length!==c.inputs.length||bits.some(b=>b!==0&&b!==1)))throw new Error('Invalid logical input case.');
  const nodes=[],edges=[],memo=new Map();
  for(const input of c.inputs)nodes.push({key:`inputs:${input.name}`,kind:'input',label:input.name,layer:0,value:values?values[input.name]:null});
  const add=tree=>{
    if(tree[0]==='input')return nodes.find(n=>n.key===`inputs:${tree[1]}`);
    const key=JSON.stringify(tree);if(memo.has(key))return memo.get(key);
    const children=tree[0]==='literal'?[]:tree.slice(1).map(add);
    const node={key:`gate:${memo.size}`,kind:tree[0],label:tree[0]==='literal'?String(Number(tree[1])):tree[0].toUpperCase(),layer:children.length?Math.max(...children.map(n=>n.layer))+1:0,value:values?booleanValue(tree,values):tree[0]==='literal'?Number(tree[1]):null};
    nodes.push(node);memo.set(key,node);children.forEach(child=>edges.push({source:child.key,target:node.key}));return node;
  };
  const outputs=c.outputs.map(output=>({output,source:add(booleanTree(output.expression,c.inputs.map(i=>i.name)))}));
  const last=Math.max(...nodes.map(n=>n.layer))+1;
  for(const {output,source} of outputs){const key=`outputs:${output.name}`;nodes.push({key,kind:'output',label:output.name,layer:last,value:source.value});edges.push({source:source.key,target:key});}
  const layers=Array.from({length:last+1},(_,layer)=>nodes.filter(n=>n.layer===layer));
  const height=Math.max(170,...layers.map(l=>l.length*76+30)),width=(last+1)*180+40;
  for(const layer of layers)layer.forEach((n,index)=>{n.x=20+n.layer*180;n.y=(height-layer.length*76)/2+index*76;n.width=124;n.height=48;});
  return {nodes,edges,width,height};
}

function channel(curve,structure){
  const columns=curve.series.filter(s=>s.name===structure);
  if(columns.length!==1)throw new Error('A mapped output trajectory is missing or ambiguous.');
  return columns[0];
}
function constraints(config,output,expected,curve){
  const one=curve.series.indexOf(channel(curve,output.one));
  if(!output.zero)return [{index:one,sign:expected?1:-1,offset:expected?-config.high:config.low}];
  const zero=curve.series.indexOf(channel(curve,output.zero));
  return [{index:expected?one:zero,sign:1,offset:-config.high},{index:expected?zero:one,sign:-1,offset:config.low}];
}
function margins(conditions,values){const result=conditions.map(c=>c.sign*values[c.index]+c.offset);if(result.some(v=>!Number.isFinite(v)))throw new Error('Threshold margin exceeds the finite numeric range.');return result;}

function sustainedResponse(curve,conditions,window){
  const first=sampleAt(curve,window.start),last=sampleAt(curve,window.end);
  if(margins(conditions,last).some(v=>v<0))return {status:'notReached',time:null,delay:null};
  // Linear half-space constraints intersect in one interval per segment. Walking
  // backward finds the last entry, including a late recrossing or dual-rail delay.
  const points=[{time:window.start,values:first}];
  curve.times.forEach((time,index)=>{if(time>window.start&&time<window.end)points.push({time,values:curve.series.map(s=>s.values[index])});});
  points.push({time:window.end,values:last});
  for(let i=points.length-2;i>=0;i--){
    const left=margins(conditions,points[i].values),right=margins(conditions,points[i+1].values);
    if(left.some(v=>v<0)){
      if(curve.mode==='step'){const time=points[i+1].time;return {status:'reached',time,delay:time-window.start};}
      const fraction=Math.max(...left.map((v,n)=>{if(v>=0)return 0;const scale=Math.max(-v,right[n]);return (-v/scale)/(-v/scale+right[n]/scale);}));
      const time=points[i].time+fraction*(points[i+1].time-points[i].time);
      return {status:'reached',time,delay:time-window.start};
    }
  }
  return {status:'atStart',time:window.start,delay:0};
}
function peak(curve,structure,window){
  const index=curve.series.indexOf(channel(curve,structure)),column=curve.series[index];
  let value=sampleAt(curve,window.start)[index],time=window.start;
  curve.times.forEach((t,i)=>{if(t>=window.start&&t<=window.end&&column.values[i]>value){value=column.values[i];time=t;}});
  const end=sampleAt(curve,window.end)[index];if(end>value){value=end;time=window.end;}
  return {value,time};
}

export function caseMetrics(config,row,analysis={start:0,end:config.time}){
  const window=readAnalysisWindow(analysis,config);
  if(row?.state!=='succeeded'||!row.curve)return {state:row?.state??'unavailable',outputs:[]};
  try{
    const curve=row.curve;
    if(curve.timeUnit!==config.timeUnit||curve.concentrationUnit!==config.unit)throw new Error('Trajectory units differ from the experiment.');
    if(!curve.times.length||curve.times.some((t,i)=>!Number.isFinite(t)||i&&t<curve.times[i-1])||curve.series.some(s=>s.values.length!==curve.times.length||s.values.some(v=>!Number.isFinite(v))))throw new Error('Invalid completed trajectory.');
    const atRead=sampleAt(curve,config.time);
    // Check both ends even when a metric would otherwise be not applicable.
    sampleAt(curve,window.start);sampleAt(curve,window.end);
    return {state:'available',outputs:config.outputs.map((o,index)=>{
      const expected=row.expected[index];if(expected!==0&&expected!==1)throw new Error('Missing expected output bit.');
      const limits=constraints(config,o,expected,curve),offRail=o.zero?(expected?o.zero:o.one):expected?null:o.one;
      return {name:o.name,expected,leakage:offRail?{...peak(curve,offRail,window),structure:offRail}:null,margin:Math.min(...margins(limits,atRead)),response:sustainedResponse(curve,limits,window)};
    })};
  }catch(error){return {state:'unavailable',message:error.message,outputs:[]};}
}

export function batchMetrics(batch){
  const window=batch.analysis??{start:0,end:batch.config.time};
  const cases=batch.cases.map(row=>caseMetrics(batch.config,row,window));
  return {window,cases,available:cases.filter(c=>c.state==='available').length,total:cases.length,outputs:batch.config.outputs.map((o,index)=>{
    const values=cases.flatMap((c,i)=>c.state==='available'?[{...c.outputs[index],caseIndex:i}]:[]);
    const leaks=values.filter(v=>v.leakage),responses=values.filter(v=>v.response.delay!==null);
    return {name:o.name,maximumLeakage:leaks.length?leaks.reduce((a,b)=>a.leakage.value>=b.leakage.value?a:b):null,minimumMargin:values.length?values.reduce((a,b)=>a.margin<=b.margin?a:b):null,maximumResponse:responses.length?responses.reduce((a,b)=>a.response.delay>=b.response.delay?a:b):null,notReached:values.filter(v=>v.response.status==='notReached').length};
  })};
}

export function metricsCsv(batch){
  const {window,cases}=batchMetrics(batch),cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const headers=[...batch.config.inputs.map(i=>i.name),'Output','Expected','Observed','Logical status','Execution state','Analysis state','Window start','Window end','Read time','Low threshold','High threshold','Leakage peak (OFF rail)','Leakage peak time','Threshold margin at read time','Sustained response status','Sustained response absolute time','Delay from window start','Concentration unit','Time unit','Engine version','Batch','Job','Diagnostic'];
  const rows=batch.cases.flatMap((row,index)=>batch.config.outputs.map((o,n)=>{
    const analysis=cases[index],m=analysis.outputs[n],verdict=readout(batch.config,row).outputs[n];
    return [...row.bits,o.name,row.expected[n],verdict?.observed??'',verdict?.status??'',row.state,analysis.state,window.start,window.end,batch.config.time,batch.config.low,batch.config.high,m?.leakage?.value??'',m?.leakage?.time??'',m?.margin??'',m?.response.status??'',m?.response.time??'',m?.response.delay??'',batch.config.unit,batch.config.timeUnit,batch.engineVersion,batch.id,row.jobId??'',analysis.message??row.message??''];
  }));
  return [headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
