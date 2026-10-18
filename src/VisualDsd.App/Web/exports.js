import { byteLength, escapeHtml } from './model.js';

export const exportTypes = Object.freeze({code:['.crn','text/plain'], sbml:['.xml','application/sbml+xml'], matlab:['.m','text/plain'], equations:['.tex','application/x-tex'], initials:['.svg','image/svg+xml'], reactions:['.svg','image/svg+xml'], moments:['.tex','application/x-tex'], closure:['.tex','application/x-tex'], 'closure-matlab':['.m','text/plain']});
export function readExports(raw) {
  const fail = () => { throw new Error('Invalid scientific export data.'); };
  if (!Array.isArray(raw) || !raw.length || raw.length > 288) fail();
  let bytes=0; const files=new Set();
  const text=(v,max)=>typeof v==='string' && v.length<=max?v:fail();
  return raw.map(item=>{
    if(!item || typeof item!=='object')fail();
    const type=exportTypes[item.id];
    if(!type || item.contentType!==type[1] || !/^[a-z0-9_-]+\.(crn|xml|m|tex|svg)$/.test(item.fileName) || !item.fileName.endsWith(type[0]) || files.has(item.fileName))fail();
    files.add(item.fileName);
    let content=null,diagnostic=null;
    if(item.content!=null){
      content=text(item.content,4*1024*1024);bytes+=byteLength(content);
      if(!content.trim() || item.diagnostic!=null || bytes>4*1024*1024)fail();
    }else{
      if(!item.diagnostic || typeof item.diagnostic!=='object')fail();
      diagnostic={code:text(item.diagnostic.code,100),message:text(item.diagnostic.message,8192)};
      if(!diagnostic.code || !diagnostic.message)fail();
    }
    return {id:item.id,name:text(item.name,128),fileName:item.fileName,contentType:item.contentType,content,diagnostic,run:text(item.run,4096),sweep:text(item.sweep,4096),assignment:text(item.assignment,8192)};
  });
}
export function exportSummary(items){
  const ready=items.filter(item=>item.content!=null).length;
  return `${ready} files ready · ${items.length-ready} unavailable`;
}

export function populationSnapshotSvg(model,run){
  if(!model?.isJit || !run?.network || !run.times?.length)throw new Error('A completed JIT run with final populations is required.');
  const populations=run.network.species.filter(s=>s.valueKind==='finalPopulation'&&!s.sourceId);
  if(!populations.length)throw new Error('No final populations are available.');
  const height=70+populations.length*112;
  const rows=populations.map((s,i)=>`<g transform="translate(20 ${70+i*112})"><text x="0" y="18" font-size="13">${escapeHtml(s.id)} = ${escapeHtml(s.initial)}</text>${s.svg?`<image x="190" y="0" width="660" height="96" href="data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}"/>`:`<text x="190" y="18" font-size="13">${escapeHtml(s.structure||s.name)}</text>`}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" style="font-family:system-ui,sans-serif;fill:#344b54"><rect width="100%" height="100%" fill="white"/><text x="20" y="30" font-size="18">Final JIT populations at t = ${escapeHtml(run.times.at(-1))} ${escapeHtml(run.settings?.timeUnit??model.settings.timeUnit)}</text>${rows}</svg>`;
}
