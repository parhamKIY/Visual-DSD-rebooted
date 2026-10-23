// Three-state dynamic programming. Gap score = open + (length - 1) * extend.
// All terminal gaps are penalized in global mode. Ambiguity symbols are literal.
export const alignmentVersion='pairwise-affine-v1';
export const alignmentLimit=500;
const cap=1000000,fail=message=>{throw new Error(`Alignment: ${message}`);};
export function alignmentInput(raw){
  if(!raw||!['DNA','RNA','protein'].includes(raw.alphabet)||typeof raw.name!=='string'||!raw.name.length||raw.name.length>120)fail('choose two named sequence records of the same alphabet.');
  const allowed=raw.alphabet==='DNA'?/^[ACGTRYSWKMBDHVN]+$/:raw.alphabet==='RNA'?/^[ACGURYSWKMBDHVN]+$/:/^[ACDEFGHIKLMNPQRSTVWYBXZJUO*]+$/;
  if(typeof raw.sequence!=='string'||raw.sequence.length>alignmentLimit||!allowed.test(raw.sequence))fail('use 1–500 ungapped symbols per sequence; select a shorter record or region first.');
  return {name:raw.name,alphabet:raw.alphabet,sequence:raw.sequence};
}
export function alignmentOptions(raw={}){
  const o={mode:raw.mode??'global',match:raw.match??2,mismatch:raw.mismatch??-1,open:raw.open??-2,extend:raw.extend??-1};
  if(!['global','local'].includes(o.mode)||[o.match,o.mismatch,o.open,o.extend].some(n=>!Number.isFinite(n)||Math.abs(n)>100||Math.abs(n*100-Math.round(n*100))>1e-7)||o.match<=0||o.mismatch>0||o.open>=0||o.extend>0)fail('match must be positive, mismatch ≤ 0, gap open < 0 and extension ≤ 0; use scores within ±100 with at most two decimal places.');
  return o;
}
export function alignPair(first,second,options={}){
  const a=alignmentInput(first),b=alignmentInput(second),o=alignmentOptions(options);
  if(a.alphabet!==b.alphabet)fail('both sequences must use the same alphabet. Transcribe or translate a separate record first.');
  const n=a.sequence.length,m=b.sequence.length,w=m+1,size=(n+1)*w,local=o.mode==='local',epsilon=1e-8;
  const scores=Array.from({length:3},()=>new Float64Array(size).fill(-Infinity)),pointers=Array.from({length:3},()=>new Uint8Array(size)),counts=Array.from({length:3},()=>new Float64Array(size));
  scores[0][0]=0;counts[0][0]=1;
  if(local){for(let i=0;i<=n;i++){scores[0][i*w]=0;counts[0][i*w]=1;}for(let j=0;j<=m;j++){scores[0][j]=0;counts[0][j]=1;}}
  else {
    for(let i=1;i<=n;i++){const k=i*w;scores[1][k]=o.open+(i-1)*o.extend;pointers[1][k]=i===1?1:2;counts[1][k]=1;}
    for(let j=1;j<=m;j++){scores[2][j]=o.open+(j-1)*o.extend;pointers[2][j]=j===1?1:4;counts[2][j]=1;}
  }
  function cell(state,k,previous,delta){
    const candidates=scores.map((s,t)=>s[previous]+delta[t]),best=Math.max(...candidates);
    if(local&&best<=epsilon){scores[state][k]=0;counts[state][k]=1;return;}
    scores[state][k]=best;let mask=0,count=0,restart=false;
    for(let t=0;t<3;t++)if(Number.isFinite(candidates[t])&&Math.abs(candidates[t]-best)<epsilon){
      if(local&&scores[t][previous]===0){if(!restart){mask|=8;count++;restart=true;}}
      else {mask|=1<<t;count=Math.min(cap,count+counts[t][previous]);}
    }
    pointers[state][k]=mask;counts[state][k]=count;
  }
  let best=local?0:-Infinity,endpoints=[];
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
    const k=i*w+j,sub=a.sequence[i-1]===b.sequence[j-1]?o.match:o.mismatch;
    cell(0,k,k-w-1,[sub,sub,sub]);cell(1,k,k-w,[o.open,o.extend,o.open]);cell(2,k,k-1,[o.open,o.open,o.extend]);
    // A local optimum never includes score-neutral terminal extensions
    // (Waterman–Eggert convention, also used by Bio.Align.PairwiseAligner).
    if(local&&sub>0){const state=0,value=scores[state][k];if(value>best+epsilon){best=value;endpoints=[{i,j,state}];}else if(value>epsilon&&Math.abs(value-best)<epsilon)endpoints.push({i,j,state});}
  }
  if(!local){const k=n*w+m;best=Math.max(...scores.map(s=>s[k]));for(let state=0;state<3;state++)if(Math.abs(scores[state][k]-best)<epsilon)endpoints.push({i:n,j:m,state});}
  let localCounts=null;
  if(local&&best>0){
    // Exclude zero-net-score extensions of an already optimal local alignment.
    // Recount paths after the optimum is known; reaching it terminates a path.
    localCounts=new Map();for(const c of counts)c.fill(0);
    for(let i=0;i<=n;i++)counts[0][i*w]=1;for(let j=0;j<=m;j++)counts[0][j]=1;
    for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)for(let state=0;state<3;state++){
      const k=i*w+j,value=scores[state][k];if(value===0){counts[state][k]=1;continue;}
      const previous=k-(state===0?w+1:state===1?w:1);let mask=pointers[state][k],count=mask&8?1:0;
      for(let t=0;t<3;t++)if(mask&(1<<t)){if(counts[t][previous]===0)mask&=~(1<<t);else count=Math.min(cap,count+counts[t][previous]);}
      pointers[state][k]=mask;if(Math.abs(value-best)<epsilon){if(state===0)localCounts.set(k,count);counts[state][k]=0;}else counts[state][k]=count;
    }
    endpoints=endpoints.filter(e=>localCounts.get(e.i*w+e.j)>0);
  }
  const optimalCount=endpoints.reduce((sum,e)=>Math.min(cap,sum+(local?localCounts?.get(e.i*w+e.j)??0:counts[e.state][e.i*w+e.j])),0),alignments=[];
  // Enumerate a bounded deterministic sample of optimal paths, never all paths.
  const stack=endpoints.slice(0,20).reverse().map(e=>({...e,end:e,steps:[],left:'',right:''}));
  while(stack.length&&alignments.length<20){
    const current=stack.pop();let {i,j,state,left,right,steps,end}=current;
    const k=i*w+j,mask=state===3?0:pointers[state][k];
    if(state===3||(local&&scores[state][k]===0)||(!local&&i===0&&j===0)){
      const alignedA=[...left].reverse().join(''),alignedB=[...right].reverse().join('');let identical=0,gaps=0;
      for(let c=0;c<alignedA.length;c++){if(alignedA[c]==='-'||alignedB[c]==='-')gaps++;else if(alignedA[c]===alignedB[c])identical++;}
      alignments.push({a:alignedA,b:alignedB,startA:i+1,endA:end.i,startB:j+1,endB:end.j,identity:alignedA.length?100*identical/alignedA.length:0,identical,gaps,coverageA:100*(end.i-i)/n,coverageB:100*(end.j-j)/m,path:steps.reverse()});continue;
    }
    const step={i,j,state},nextI=i-(state!==2?1:0),nextJ=j-(state!==1?1:0);
    left+=state===2?'-':a.sequence[i-1];right+=state===1?'-':b.sequence[j-1];steps=[...steps,step];
    for(let previous=3;previous>=0;previous--)if(mask&(1<<previous))stack.push({i:nextI,j:nextJ,state:previous,end,left,right,steps});
  }
  return {version:alignmentVersion,first:a,second:b,options:o,score:best,optimalCount,countCapped:optimalCount===cap,alignments,matrix:{scores,pointers,width:w,rows:n+1,columns:m+1}};
}
export function readAlignmentStudy(raw){
  if(!raw||raw.version!==alignmentVersion||typeof raw.createdAt!=='string'||!Number.isFinite(Date.parse(raw.createdAt)))fail('invalid saved alignment or algorithm version.');
  const first=alignmentInput(raw.first),second=alignmentInput(raw.second),options=alignmentOptions(raw.options);
  if(first.alphabet!==second.alphabet)fail('saved sequence alphabets differ.');
  return {version:alignmentVersion,createdAt:raw.createdAt,first,second,options};
}
export function alignmentText(result,index=0){
  const row=result.alignments[index];let text=`${result.version}\n${result.options.mode} · literal-symbol scoring\n${JSON.stringify(result.options)}\nScore: ${result.score}; optimal paths: ${result.countCapped?'>=':''}${result.optimalCount}\n`;
  if(!row)return text+'No positive-scoring local alignment.\n';
  text+=`${result.first.name}: ${row.startA}..${row.endA}; ${result.second.name}: ${row.startB}..${row.endB} (1-based, inclusive)\n`;
  for(let c=0;c<row.a.length;c+=70){const a=row.a.slice(c,c+70),b=row.b.slice(c,c+70);text+=`\n${a}\n${[...a].map((v,i)=>v===b[i]?'|':v==='-'||b[i]==='-'?' ':'.').join('')}\n${b}\n`;}
  return text;
}
