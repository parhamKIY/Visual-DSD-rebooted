import { csvFor, numberLabel } from './model.js';

export function splitRHat(chains) {
  if (chains.length < 2 || chains.some(c => c.length < 4)) return null;
  const n = Math.min(...chains.map(c => Math.floor(c.length / 2)));
  const halves = chains.flatMap(c => [c.slice(0,n),c.slice(-n)]);
  const means = halves.map(c => c.reduce((a,v)=>a+v,0)/n);
  const within = halves.reduce((s,c,i)=>s+c.reduce((a,v)=>a+(v-means[i])**2,0)/(n-1),0)/halves.length;
  const mean = means.reduce((a,v)=>a+v,0)/means.length;
  const between = n*means.reduce((a,v)=>a+(v-mean)**2,0)/(means.length-1);
  const value = Math.sqrt(((n-1)/n*within+between/n)/within);
  return within > 0 && Number.isFinite(value) ? value : null;
}

export function histogram(samples, maximumBins=32) {
  let min=Math.min(...samples), max=Math.max(...samples);
  if(min===max) { const pad=Math.abs(min)*.05 || .5; min-=pad; max+=pad; }
  const count=Math.min(maximumBins,Math.max(1,Math.ceil(Math.sqrt(samples.length)))), width=(max-min)/count;
  const bins=Array.from({length:count},(_,i)=>({low:min+i*width,high:min+(i+1)*width,count:0}));
  for(const value of samples) bins[Math.min(count-1,Math.max(0,Math.floor((value-min)/width)))].count++;
  return bins.map(bin=>({...bin,density:bin.count/(samples.length*width)}));
}

export function correlation(x,y) {
  const mx=x.reduce((a,v)=>a+v,0)/x.length,my=y.reduce((a,v)=>a+v,0)/y.length;
  const vx=x.reduce((a,v)=>a+(v-mx)**2,0),vy=y.reduce((a,v)=>a+(v-my)**2,0);
  return vx>0 && vy>0 ? x.reduce((a,v,i)=>a+(v-mx)*(y[i]-my),0)/Math.sqrt(vx*vy) : null;
}

export function posteriorCsv(fit) {
  if(!fit.chains?.length) return csvFor({times:fit.logLikelihood.map((_,i)=>i+1),series:[{name:'logLikelihood',values:fit.logLikelihood},...fit.parameters.map(p=>({name:p.name,values:p.samples}))]}).replace(/^Time,/, 'Retained sample,');
  return fit.chains.map((c,i)=>{
    const csv=csvFor({times:c.iterations,series:[{name:'Chain seed',values:c.iterations.map(()=>c.seed)},{name:'Included in pooled posterior',values:c.iterations.map(()=>c.included?1:0)},{name:'logLikelihood',values:c.logLikelihood},{name:'logPrior',values:c.logPrior},...c.parameters.map(p=>({name:p.name,values:p.samples}))]}).replace(/^Time,/, 'Recorded iteration,');
    return i ? csv.slice(csv.indexOf('\r\n')+2) : csv;
  }).join('');
}

const colors=['#0b6e63','#db7737','#4d73b5','#aa558c'];
function canvas(svg,width,height,label) {
  svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${width} ${height}`); svg.setAttribute('aria-label',label);
  const make=(tag,attrs={},value)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(value!==undefined)e.textContent=value;svg.append(e);return e;};
  make('rect',{width,height,fill:'white'});
  const text=(x,y,value,extra={})=>make('text',{x,y,fill:'#52626b','font-family':'sans-serif','font-size':11,...extra},value);
  return {make,text};
}
function extent(values) {let low=Math.min(...values),high=Math.max(...values);if(low===high){const pad=Math.abs(low)*.05||.5;low-=pad;high+=pad;}return[low,high];}

export function drawTrace(svg,fit,parameter=null) {
  const {make,text}=canvas(svg,800,200,parameter?`Retained parameter traces for ${parameter}`:'Retained log likelihood by chain');
  const chains=fit.chains?.length?fit.chains:[{seed:fit.seed,included:true,logLikelihood:fit.logLikelihood,parameters:fit.parameters}];
  const sets=chains.map(c=>({chain:c,values:parameter?c.parameters.find(p=>p.name===parameter).samples:c.logLikelihood}));
  const [low,high]=extent(sets.flatMap(s=>s.values));
  const n=Math.max(...sets.map(s=>s.values.length));
  for(const [i,{chain,values}]of sets.entries())make('path',{d:values.map((v,j)=>`${j?'L':'M'}${65+j*700/Math.max(1,n-1)} ${150-(v-low)*115/(high-low)}`).join(''),fill:'none',stroke:chain.included?colors[i%colors.length]:'#99a3a5','stroke-width':1.6,...(!chain.included?{'stroke-dasharray':'5 3'}:{})});
  text(65,18,parameter||'logLikelihood');text(55,42,numberLabel(high),{'text-anchor':'end'});text(55,151,numberLabel(low),{'text-anchor':'end'});
  text(65,176,'1');text(765,176,String(n),{'text-anchor':'end'});text(340,193,'Retained draw within each chain');
}

export function drawMarginal(svg,parameter) {
  const {make,text}=canvas(svg,400,260,`Pooled posterior density for ${parameter.name}`),bins=histogram(parameter.samples),max=Math.max(...bins.map(b=>b.density));
  const low=bins[0].low,high=bins.at(-1).high;
  for(const [i,b]of bins.entries()){const rect=make('rect',{x:50+i*320/bins.length,y:210-b.density/max*165,width:320/bins.length-.5,height:b.density/max*165,fill:colors[0]});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${b.low}..${b.high}: ${b.count} draws, density=${b.density}`;rect.append(title);}
  text(50,20,`${parameter.name} · pooled density`);text(45,48,numberLabel(max),{'text-anchor':'end'});text(50,230,numberLabel(low));text(370,230,numberLabel(high),{'text-anchor':'end'});text(150,250,parameter.name);
}

export function drawPair(svg,a,b) {
  const {make,text}=canvas(svg,400,260,b?`Joint posterior samples for ${a.name} and ${b.name}`:'A second parameter is needed for a joint posterior plot');
  if(!b){text(50,120,'A second parameter is needed for a joint plot.');return;}
  const [xmin,xmax]=extent(a.samples),[ymin,ymax]=extent(b.samples),r=correlation(a.samples,b.samples);
  for(let i=0;i<a.samples.length;i++) {const dot=make('circle',{cx:55+(a.samples[i]-xmin)/(xmax-xmin)*310,cy:210-(b.samples[i]-ymin)/(ymax-ymin)*165,r:2.2,fill:colors[0],opacity:.35});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${a.name}=${a.samples[i]}, ${b.name}=${b.samples[i]}`;dot.append(title);}
  text(55,20,`Joint draws · correlation ${r===null?'undefined':numberLabel(r)}`);text(45,48,numberLabel(ymax),{'text-anchor':'end'});text(45,212,numberLabel(ymin),{'text-anchor':'end'});text(55,230,numberLabel(xmin));text(365,230,numberLabel(xmax),{'text-anchor':'end'});text(170,250,a.name);text(10,130,b.name,{transform:'rotate(-90 10 130)'});
}
