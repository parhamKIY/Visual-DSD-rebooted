import {readAlignmentStudy} from './alignment.js';
import {readBlastImport} from './blast.js';
const fail=()=>{throw new Error('Sequences: invalid saved analysis or NCBI provenance.');};
export function readRetrieval(raw){
  if(raw==null)return null;
  if(raw.service!=='NCBI E-utilities'||!['nuccore','protein'].includes(raw.database)||typeof raw.requested!=='string'||!/^[A-Za-z0-9_.]{1,80}$/.test(raw.requested)||typeof raw.accessionVersion!=='string'||!/^[A-Za-z0-9_]+\.\d+$/.test(raw.accessionVersion)||!Number.isFinite(Date.parse(raw.retrievedAt))||typeof raw.url!=='string'||!raw.url.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?')||!/^[a-f0-9]{64}$/.test(raw.sha256))fail();
  return {service:raw.service,database:raw.database,requested:raw.requested,accessionVersion:raw.accessionVersion,retrievedAt:raw.retrievedAt,url:raw.url,sha256:raw.sha256};
}
export function readSequenceAnalysis(raw){
  if(raw==null)return {version:1,alignments:[],blast:null,search:null};
  if(raw.version!==1||!Array.isArray(raw.alignments)||raw.alignments.length>10)fail();
  let search=null;
  if(raw.search!=null){const s=raw.search;if(!['nuccore','protein'].includes(s.database)||typeof s.term!=='string'||s.term.length>300||!Number.isInteger(s.start)||s.start<0||s.start>1000||!Number.isSafeInteger(s.count)||s.count<0||!Number.isFinite(Date.parse(s.retrievedAt))||!Array.isArray(s.records)||s.records.length>10)fail();
    search={database:s.database,term:s.term,start:s.start,count:s.count,retrievedAt:s.retrievedAt,records:s.records.map(r=>{if(!/^\d+$/.test(r.uid)||typeof r.accessionVersion!=='string'||!/^[A-Za-z0-9_]+\.\d+$/.test(r.accessionVersion)||typeof r.title!=='string'||r.title.length>4000||!Number.isSafeInteger(r.length)||r.length<1)fail();return {uid:r.uid,accessionVersion:r.accessionVersion,title:r.title,length:r.length};})};
  }
  return {version:1,alignments:raw.alignments.map(readAlignmentStudy),blast:readBlastImport(raw.blast),search};
}
