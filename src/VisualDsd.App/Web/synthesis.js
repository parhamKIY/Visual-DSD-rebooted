import { escapeHtml } from './model.js';

const esc=escapeHtml, fmt=value=>String(Number(Number(value).toPrecision(5)));
const fail=message=>{throw new Error(`Invalid synthesis result: ${message}`);};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail('missing object');
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:fail('nonfinite number');
const text=(v,max=262144)=>typeof v==='string'&&v.length<=max?v:fail('invalid text');
const list=(v,max)=>Array.isArray(v)&&v.length<=max?v:fail('oversized or missing list');
const numbers=(v,max)=>list(v,max).map(num);
const choice=(v,values)=>values.includes(v)?v:fail('unknown setting');
const close=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));

export function readSynthesis(raw,speciesIds){
  obj(raw);
  const mode=choice(raw.mode,['turing','multistability']), solver=choice(raw.solver,['nlsat','portfolio']),status=choice(raw.status,['SAT','UNSAT','UNKNOWN']);
  const solverSeconds=num(raw.solverSeconds);if(solverSeconds<0)fail('negative solver duration');
  const seed=raw.seed==null?null:num(raw.seed);if(seed!==null&&(!Number.isInteger(seed)||seed< -2147483648||seed>2147483647))fail('invalid seed');
  const values=list(raw.values,256).map(v=>{obj(v);const lowerBound=v.lowerBound==null?null:num(v.lowerBound),upperBound=v.upperBound==null?null:num(v.upperBound);const value=num(v.value);
    if(lowerBound!==null&&value<lowerBound-1e-8||upperBound!==null&&value>upperBound+1e-8)fail('witness outside bounds');
    return{name:text(v.name,512),kind:choice(v.kind,['parameter','diffusion','equilibrium','auxiliary']),value,lowerBound,upperBound};});
  if(new Set(values.map(v=>v.name)).size!==values.length)fail('duplicate witness variable');
  const equilibria=list(raw.equilibria,2).map(e=>{obj(e);const species=list(e.species,8).map(v=>text(v,512)),n=species.length;
    if(!n||new Set(species).size!==n||species.some(s=>!speciesIds.includes(s)))fail('unknown equilibrium species');
    const state=numbers(e.values,n),residuals=numbers(e.residuals,n),jacobian=list(e.jacobian,n).map(row=>numbers(row,n));
    if(state.length!==n||residuals.length!==n||jacobian.length!==n||jacobian.some(row=>row.length!==n))fail('inconsistent equilibrium dimensions');
    return{name:text(e.name,100),species,values:state,residuals,maximumRealEigenvalue:num(e.maximumRealEigenvalue),jacobian};});
  let dispersion=null,phasePortrait=null;
  if(raw.dispersion!=null){
    obj(raw.dispersion);const d=raw.dispersion,waveNumbers=numbers(d.waveNumbers,256),growthRates=numbers(d.growthRates,256),witnessWaveNumber=num(d.witnessWaveNumber),witnessGrowthRate=num(d.witnessGrowthRate);
    if(mode!=='turing'||waveNumbers.length<2||waveNumbers.length!==growthRates.length||waveNumbers[0]!==0||waveNumbers.some((v,i)=>v<0||(i&&v<=waveNumbers[i-1]))||witnessWaveNumber<=0)fail('invalid dispersion samples');
    const index=waveNumbers.findIndex(w=>close(w,witnessWaveNumber));
    if(index<0||!close(growthRates[index],witnessGrowthRate)||!close(growthRates[0],equilibria[0]?.maximumRealEigenvalue??NaN))fail('dispersion witness mismatch');
    const squared=values.find(v=>v.name==='wc')?.value;if(!close(witnessWaveNumber*witnessWaveNumber,squared??NaN))fail('squared wave number mismatch');
    dispersion={waveNumbers,growthRates,witnessWaveNumber,witnessGrowthRate};
  }
  if(raw.phasePortrait!=null){
    obj(raw.phasePortrait);const p=raw.phasePortrait,speciesX=text(p.speciesX,512),speciesY=text(p.speciesY,512),equilibriumX=numbers(p.equilibriumX,2),equilibriumY=numbers(p.equilibriumY,2);
    if(mode!=='multistability'||equilibria.length!==2||speciesX===speciesY||equilibriumX.length!==2||equilibriumY.length!==2)fail('invalid phase species');
    equilibria.forEach((e,i)=>{if(!close(equilibriumX[i],e.values[e.species.indexOf(speciesX)]??NaN)||!close(equilibriumY[i],e.values[e.species.indexOf(speciesY)]??NaN))fail('phase equilibrium mismatch');});
    const trajectories=list(p.trajectories,16).map(t=>{obj(t);const initialX=num(t.initialX),initialY=num(t.initialY),times=numbers(t.times,256),x=numbers(t.x,256),y=numbers(t.y,256),nearestEquilibrium=choice(t.nearestEquilibrium,[0,1]),finalDistance=num(t.finalDistance);
      if(!times.length||x.length!==times.length||y.length!==times.length||times.some((v,i)=>i&&v<=times[i-1])||!close(x[0],initialX)||!close(y[0],initialY)||finalDistance<0)fail('invalid phase trajectory');
      const distances=equilibriumX.map((ex,i)=>Math.hypot(ex-x.at(-1),equilibriumY[i]-y.at(-1)));
      if(!close(finalDistance,distances[nearestEquilibrium])||distances[nearestEquilibrium]>Math.min(...distances)+1e-8)fail('phase distance mismatch');
      return{initialX,initialY,times,x,y,nearestEquilibrium,finalDistance};});
    if(!trajectories.length)fail('empty phase portrait');
    phasePortrait={speciesX,speciesY,equilibriumX,equilibriumY,trajectories};
  }
  const code=raw.code==null?null:text(raw.code);
  if(status==='SAT'){
    if(!code||equilibria.length!==(mode==='turing'?1:2)||(mode==='turing'&&!dispersion))fail('missing satisfying witness');
    equilibria.forEach((e,i)=>e.species.forEach((name,j)=>{const key=mode==='turing'?name:`${name}_${i+1}`;if(!close(values.find(v=>v.name===key)?.value??NaN,e.values[j]))fail('equilibrium witness mismatch');}));
  }else if(values.length||equilibria.length||dispersion||phasePortrait||code!==null)fail('a non-satisfiable result cannot contain a witness');
  return{mode,solver,status,solverSeconds,values,rateEquations:text(raw.rateEquations),jacobian:text(raw.jacobian),diffusion:text(raw.diffusion),constraints:text(raw.constraints),equilibria,dispersion,phasePortrait,code,seed};
}

const colors=['#087f8c','#bb5b28'];
function bounds(values){let lo=Math.min(...values),hi=Math.max(...values);if(lo===hi){lo-=.5;hi+=.5;}const pad=(hi-lo)*.07;return[lo-pad,hi+pad];}
function canvas(xs,ys,xlabel,ylabel,title){
  const [xl,xh]=bounds(xs),[yl,yh]=bounds(ys),x=v=>70+(v-xl)/(xh-xl)*610,y=v=>285-(v-yl)/(yh-yl)*230;
  let content=`<rect width="750" height="340" fill="white"/><text x="70" y="26" font-size="15" fill="#1c2d36">${esc(title)}</text>`;
  for(let i=0;i<5;i++){const xv=xl+(xh-xl)*i/4,yv=yl+(yh-yl)*i/4;content+=`<path d="M${x(xv)} 55V285M70 ${y(yv)}H680" stroke="#e5eceb"/><text x="${x(xv)}" y="304" text-anchor="middle" font-size="10">${esc(fmt(xv))}</text><text x="62" y="${y(yv)+3}" text-anchor="end" font-size="10">${esc(fmt(yv))}</text>`;}
  content+=`<text x="375" y="330" text-anchor="middle" font-size="12">${esc(xlabel)}</text><text x="16" y="165" text-anchor="middle" font-size="11" transform="rotate(-90 16 165)">${esc(ylabel)}</text>`;
  return{x,y,content,yl,yh};
}
function svg(content){return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 340" role="img" style="font-family:system-ui,sans-serif;fill:#344b54">${content}</svg>`;}
const line=(xs,ys,x,y)=>xs.map((v,i)=>`${i?'L':'M'}${x(v).toFixed(3)} ${y(ys[i]).toFixed(3)}`).join('');
export function dispersionSvg(result){
  const d=result?.dispersion;if(!d)return svg('<text x="40" y="80">No dispersion curve for this result.</text>');
  const positive=d.growthRates.map((v,i)=>v>0?i:-1).filter(i=>i>=0),end=positive.length?Math.min(d.waveNumbers.length,positive.at(-1)+5):d.waveNumbers.length;
  const waves=d.waveNumbers.slice(0,end),growth=d.growthRates.slice(0,end);
  const c=canvas(waves,growth,'Wave number q · instability band','Largest real eigenvalue','Dispersion · J − q²D');let out=c.content;
  if(c.yl<0&&c.yh>0)out+=`<path d="M70 ${c.y(0)}H680" stroke="#7f929c" stroke-dasharray="4 4"/>`;
  out+=`<path d="${line(waves,growth,c.x,c.y)}" fill="none" stroke="${colors[0]}" stroke-width="2"/><circle cx="${c.x(d.witnessWaveNumber)}" cy="${c.y(d.witnessGrowthRate)}" r="4" fill="${colors[1]}"><title>Synthesized witness: q=${d.witnessWaveNumber}, growth=${d.witnessGrowthRate}</title></circle>`;
  return svg(out);
}
export function phaseSvg(result){
  const p=result?.phasePortrait;if(!p)return svg('<text x="40" y="80">No phase trajectories requested for this result.</text>');
  const xs=[...p.equilibriumX,...p.trajectories.flatMap(t=>t.x)],ys=[...p.equilibriumY,...p.trajectories.flatMap(t=>t.y)],c=canvas(xs,ys,p.speciesX,p.speciesY,'Phase portrait · sampled initial conditions');let out=c.content;
  for(const t of p.trajectories)out+=`<path d="${line(t.x,t.y,c.x,c.y)}" fill="none" stroke="${colors[t.nearestEquilibrium]}" stroke-width="1.5" opacity=".75"><title>Initial (${t.initialX}, ${t.initialY}); final distance ${t.finalDistance}</title></path><circle cx="${c.x(t.initialX)}" cy="${c.y(t.initialY)}" r="2.5" fill="white" stroke="${colors[t.nearestEquilibrium]}"/>`;
  p.equilibriumX.forEach((x,i)=>{out+=`<circle cx="${c.x(x)}" cy="${c.y(p.equilibriumY[i])}" r="6" stroke="white" stroke-width="2" fill="${colors[i]}"><title>Equilibrium ${i+1}: (${x}, ${p.equilibriumY[i]})</title></circle>`;});
  return svg(out);
}
export function jacobianSvg(result){
  const eqs=result?.equilibria??[];let out='<rect width="750" height="340" fill="white"/>';
  eqs.forEach((e,ei)=>{
    const cx=eqs.length===1?375:190+ei*370,cy=180,r=e.species.length===1?0:92,points=e.species.map((_,i)=>[cx+r*Math.cos(2*Math.PI*i/e.species.length-Math.PI/2),cy+r*Math.sin(2*Math.PI*i/e.species.length-Math.PI/2)]);
    out+=`<text x="${cx}" y="26" text-anchor="middle" font-size="14">${esc(e.name)}</text><defs><marker id="arrow-${ei}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0L7 3L0 6" fill="#607d83"/></marker></defs>`;
    e.jacobian.forEach((row,target)=>row.forEach((v,source)=>{if(v===0)return;const [sx,sy]=points[source],[tx,ty]=points[target];const label=`${e.species[source]} → ${e.species[target]}: ${v}`;
      if(source===target)out+=`<path d="M${sx-13} ${sy-18}C${sx-70} ${sy-82},${sx+70} ${sy-82},${sx+13} ${sy-18}" fill="none" stroke="${v>0?colors[1]:colors[0]}" marker-end="url(#arrow-${ei})"><title>${esc(label)}</title></path>`;
      else{const len=Math.hypot(tx-sx,ty-sy),ex=tx-24*(tx-sx)/len,ey=ty-24*(ty-sy)/len;out+=`<path d="M${sx} ${sy}L${ex} ${ey}" fill="none" stroke="${v>0?colors[1]:colors[0]}" marker-end="url(#arrow-${ei})"><title>${esc(label)}</title></path>`;}
    }));
    points.forEach(([x,y],i)=>{out+=`<circle cx="${x}" cy="${y}" r="23" fill="#e8f4ef" stroke="#9ac6bd"/><text x="${x}" y="${y+4}" text-anchor="middle" font-size="11">${esc(e.species[i])}</text>`;});
  });return svg(out);
}
export function synthesisCsv(result){
  const rows=[['section','equilibrium','trajectory','name','time','wave_number','value','x','y']];
  rows.push(['metadata','','','mode','','',result.mode,'',''],['metadata','','','status','','',result.status,'','']);
  for(const v of result.values)rows.push([v.kind,'','',v.name,'','',v.value,'','']);
  result.equilibria.forEach((e,i)=>e.species.forEach((s,j)=>{rows.push(['equilibrium',i+1,'',s,'','',e.values[j],'','']);rows.push(['residual',i+1,'',s,'','',e.residuals[j],'','']);}));
  result.dispersion?.waveNumbers.forEach((q,i)=>rows.push(['dispersion','','','','',q,result.dispersion.growthRates[i],'','']));
  result.phasePortrait?.trajectories.forEach((t,i)=>t.times.forEach((time,j)=>rows.push(['trajectory',t.nearestEquilibrium+1,i+1,'',time,'','',t.x[j],t.y[j]])));
  return rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n';
}
