import {readMsa} from './msa.js';
import {parseNewick,treeVersion,distanceOptions} from './phylogeny.js';
const fail=()=>{throw new Error('Evolution: invalid saved alignment, tree or provenance.');};
export function readTreeStudy(raw){
  if(!raw||typeof raw.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(raw.id)||!['imported','built'].includes(raw.kind)||!Number.isFinite(Date.parse(raw.createdAt))||typeof raw.file!=='string'||raw.file.length>240||typeof raw.notes!=='string'||raw.notes.length>2000)fail();
  const tree=parseNewick(raw.newick),result={id:raw.id,kind:raw.kind,createdAt:raw.createdAt,file:raw.file,notes:raw.notes,newick:raw.newick,links:{}};
  if(raw.kind==='built'){if(raw.version!==treeVersion||!/^[a-f0-9]{64}$/.test(raw.inputSha256))fail();result.version=raw.version;result.alignment=readMsa(raw.alignment);result.options=distanceOptions(result.alignment,raw.options);result.inputSha256=raw.inputSha256;}
  if(raw.links!=null){if(typeof raw.links!=='object'||Array.isArray(raw.links)||Object.keys(raw.links).length>200)fail();for(const [name,id] of Object.entries(raw.links)){if(!tree.leaves.some(l=>l.name===name)||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))fail();Object.defineProperty(result.links,name,{value:id,enumerable:true,writable:true,configurable:true});}}
  return result;
}
export function readEvolution(raw){
  if(raw==null)return {version:1,alignment:null,trees:[],activeTreeId:null};
  if(raw.version!==1||!Array.isArray(raw.trees)||raw.trees.length>3)fail();const trees=raw.trees.map(readTreeStudy);
  if(new Set(trees.map(t=>t.id)).size!==trees.length||(trees.length?!trees.some(t=>t.id===raw.activeTreeId):raw.activeTreeId!==null))fail();
  return {version:1,alignment:raw.alignment==null?null:readMsa(raw.alignment),trees,activeTreeId:raw.activeTreeId};
}
