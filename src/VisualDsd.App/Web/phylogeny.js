import {readMsa,calledLetters} from './msa.js';
const fail=message=>{throw new Error(`Tree: ${message}`);};
export const treeVersion='distance-tree-v1';
export function parseNewick(input){
  if(typeof input!=='string'||input.length>128*1024||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))fail('use a single Newick tree of at most 128 KiB.');
  let at=0,nodes=0;const leaves=[],names=new Set();const white=()=>{while(/\s/.test(input[at]??'')&&at<input.length)at++;};
  function comments(){const list=[];white();while(input[at]==='['){at++;let depth=1,text='';while(at<input.length&&depth){const c=input[at++];if(c==='[')depth++;if(c===']')depth--;if(depth)text+=c;if(depth>10||text.length>4000)fail('comment is too large.');}if(depth)fail('unterminated comment.');list.push(text);white();}return list;}
  function label(){white();if(input[at]==="'"){at++;let text='',closed=false;while(at<input.length){const c=input[at++];if(c==="'"){if(input[at]==="'"){text+="'";at++;}else{closed=true;break;}}else text+=c;}if(!closed)fail('unterminated quoted label.');if(text.length>240)fail('label exceeds 240 characters.');return text;}const start=at;while(at<input.length&&!/[\s(),:;\[\]]/.test(input[at]))at++;const text=input.slice(start,at);if(text.includes("'")||text.length>240)fail('quote labels containing punctuation or spaces.');return text;}
  function subtree(depth){
    if(depth>100||++nodes>500)fail('tree exceeds 100 nested levels or 500 nodes.');const leading=comments(),node={id:`node-${nodes}`,name:'',length:null,comments:leading,children:[]};
    if(input[at]==='('){at++;node.children.push(subtree(depth+1));white();while(input[at]===','){at++;node.children.push(subtree(depth+1));white();}if(input[at++]!==')')fail('expected closing parenthesis.');}
    node.comments.push(...comments());node.name=label();node.comments.push(...comments());white();
    if(input[at]===':'){at++;white();const m=input.slice(at).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);if(!m||!Number.isFinite(Number(m[0])))fail('branch length must be a finite number.');node.length=Number(m[0]);at+=m[0].length;node.comments.push(...comments());}
    if(!node.children.length){if(!node.name||names.has(node.name)||leaves.length>=200)fail('use 1–200 leaves with nonempty, distinct labels.');names.add(node.name);leaves.push(node);}
    return node;
  }
  const root=subtree(0);white();if(input[at++]!==';')fail('one tree must end in a semicolon.');const trailing=comments();white();if(at!==input.length)fail('multiple trees or trailing text are not supported.');root.comments.push(...trailing);
  const flags=root.comments.map(c=>c.trim().toUpperCase()),rooting=flags.includes('&R')?'rooted':flags.includes('&U')?'unrooted':'unknown';if(flags.includes('&R')&&flags.includes('&U'))fail('conflicting rooting flags.');
  return {root,leaves,rooting};
}
export function toNewick(root,rooting='unknown'){
  const quote=value=>value?`'${value.replaceAll("'","''")}'`:'';
  const write=n=>`${n.children.length?'('+n.children.map(write).join(',')+')':''}${quote(n.name)}${n.length==null?'':':'+Number(n.length.toPrecision(14))}${(n.comments??[]).filter(c=>!/^&[RU]$/i.test(c.trim())).map(c=>'['+c+']').join('')}`;
  return (rooting==='rooted'?'[&R]':rooting==='unrooted'?'[&U]':'')+write(root)+';';
}
export function distanceOptions(msa,raw={}){
  const width=msa.records[0].sequence.length,options={method:raw.method??'nj',model:raw.model??'p',deletion:raw.deletion??'complete',start:raw.start??1,end:raw.end??width};
  if(!['nj','upgma'].includes(options.method)||!['p','jc69'].includes(options.model)||!['complete','pairwise'].includes(options.deletion)||!Number.isInteger(options.start)||!Number.isInteger(options.end)||options.start<1||options.end<options.start||options.end>width||options.model==='jc69'&&msa.alphabet==='protein')fail('choose a valid method, distance, deletion policy and column range; JC69 requires DNA/RNA.');return options;
}
export function alignmentDistances(raw,settings={}){
  const msa=readMsa(raw),options=distanceOptions(msa,settings),called=calledLetters(msa.alphabet),names=msa.records.map(r=>r.name),n=names.length,matrix=Array.from({length:n},()=>Array(n).fill(0)),sites=Array.from({length:n},()=>Array(n).fill(0));
  const complete=[];for(let c=options.start-1;c<options.end;c++)if(msa.records.every(r=>called.includes(r.sequence[c])))complete.push(c);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let valid=0,different=0;const columns=options.deletion==='complete'?complete:null;
    for(let k=0;k<(columns?.length??options.end-options.start+1);k++){const c=columns?columns[k]:options.start-1+k,a=msa.records[i].sequence[c],b=msa.records[j].sequence[c];if(called.includes(a)&&called.includes(b)){valid++;if(a!==b)different++;}}
    if(i!==j&&!valid)fail(`no comparable called sites for ${names[i]} / ${names[j]}; choose a different range or deletion policy.`);
    const p=valid?different/valid:0;if(options.model==='jc69'&&p>=.75)fail(`JC69 is undefined/saturated for ${names[i]} / ${names[j]} (p ≥ 0.75). Use p-distance or another dataset; no finite distance was guessed.`);
    matrix[i][j]=matrix[j][i]=options.model==='jc69'?(p===0?0:-.75*Math.log1p(-4*p/3)):p;sites[i][j]=sites[j][i]=valid;
  }
  return {names,matrix,sites,options,completeSites:complete.length,columns:options.end-options.start+1};
}
export function buildDistanceTree(raw,settings={}){
  const msa=readMsa(raw),distance=alignmentDistances(msa,settings),method=distance.options.method;
  let clusters=msa.records.map((r,i)=>({node:{name:r.name,length:null,comments:[],children:[]},size:1,height:0,key:i})),matrix=distance.matrix.map(r=>[...r]);const merges=[];
  while(clusters.length>(method==='nj'?3:1)){
    const n=clusters.length,sums=matrix.map(r=>r.reduce((s,v)=>s+v,0));let a=0,b=1,best=Infinity;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const criterion=method==='nj'?(n-2)*matrix[i][j]-sums[i]-sums[j]:matrix[i][j];if(criterion<best-1e-12){best=criterion;a=i;b=j;}}
    const first=clusters[a],second=clusters[b],height=matrix[a][b]/2;
    if(method==='upgma'){first.node.length=height-first.height;second.node.length=height-second.height;}
    else {first.node.length=.5*(matrix[a][b]+(sums[a]-sums[b])/(n-2));second.node.length=matrix[a][b]-first.node.length;}
    const joined={node:{name:'',length:null,comments:[],children:[first.node,second.node]},size:first.size+second.size,height,key:Math.min(first.key,second.key)},remaining=clusters.map((_,i)=>i).filter(i=>i!==a&&i!==b),newDistances=remaining.map(i=>method==='nj'?.5*(matrix[a][i]+matrix[b][i]-matrix[a][b]):(first.size*matrix[a][i]+second.size*matrix[b][i])/(first.size+second.size));
    merges.push({left:first.node.name||`cluster ${first.size}`,right:second.node.name||`cluster ${second.size}`,criterion:best});
    matrix=remaining.map((i,k)=>[...remaining.map(j=>matrix[i][j]),newDistances[k]]);matrix.push([...newDistances,0]);clusters=[...remaining.map(i=>clusters[i]),joined];
  }
  let root;
  if(method==='upgma')root=clusters[0].node;
  else {const n=clusters.length;if(n===2){clusters[0].node.length=matrix[0][1]/2;clusters[1].node.length=matrix[0][1]/2;}else {const a=(matrix[0][1]+matrix[0][2]-matrix[1][2])/2;clusters[0].node.length=a;clusters[1].node.length=matrix[0][1]-a;clusters[2].node.length=matrix[0][2]-a;}root={name:'',length:null,comments:[],children:clusters.map(c=>c.node)};}
  const rooting=method==='upgma'?'rooted':'unrooted',newick=toNewick(root,rooting),tree=parseNewick(newick);return {version:treeVersion,newick,tree,distance,merges};
}
export function treeEdges(tree){const edges=[];const walk=node=>{for(const child of node.children){edges.push({parent:node,child,length:child.length});walk(child);}};walk(tree.root);return edges;}
