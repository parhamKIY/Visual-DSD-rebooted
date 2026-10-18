import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readSynthesis,phaseSvg,dispersionSvg,jacobianSvg,synthesisCsv} from '../../src/VisualDsd.App/Web/synthesis.js';
import {readResponse,serialiseProject,parseProject,resultIsCurrent} from '../../src/VisualDsd.App/Web/project.js';
import {createDocument,requestFor} from '../../src/VisualDsd.App/Web/model.js';
globalThis.crypto??=webcrypto;
const clone=v=>structuredClone(v);
function synthesis(){return{mode:'multistability',solver:'nlsat',status:'SAT',solverSeconds:.1,seed:7,values:['X_1','Y_1','X_2','Y_2'].map((name,i)=>({name,kind:'equilibrium',value:i<2?1:3,lowerBound:0,upperBound:null})),rateEquations:'dX/dt = 0',jacobian:'J',diffusion:'D',constraints:'constraints',code:'| 1 X | 1 Y',equilibria:[1,3].map((v,i)=>({name:'Equilibrium '+(i+1),species:['X','Y'],values:[v,v],residuals:[0,0],maximumRealEigenvalue:-1,jacobian:[[-2,0],[1,-1]]})),dispersion:null,phasePortrait:{speciesX:'X',speciesY:'Y',equilibriumX:[1,3],equilibriumY:[1,3],trajectories:[{initialX:.5,initialY:.5,times:[0,1],x:[.5,1],y:[.5,1],nearestEquilibrium:0,finalDistance:0}]}};}
function fixture(){const doc=createDocument('synthesis.dsd','<a>');const settings={simulator:'oslo',initial:0,final:20,points:100,seed:null,timeUnit:'s',concentrationUnit:'nM'};const response={success:true,operation:'synthesize',dialect:'current',diagnostics:[],model:{kind:'classic',compilation:'default',isJit:false,settings,species:['X','Y'].map(id=>({id,name:id,structure:id,svg:'',initial:'1',constant:false,time:null,valueKind:'initial'})),reactions:[],simulations:[],synthesis:synthesis()}};const view={response,snapshot:{name:doc.name,request:requestFor(doc,'synthesize'),engineVersion:'0.14.0'},tab:'synthesis',runIndex:0};return{doc,response,view};}

test('synthesis projects retain the witness, selected phase configuration and all samples',()=>{
 const{doc,response,view}=fixture();Object.assign(doc.options,{phaseX:'Y',phaseY:'X',phaseTrajectories:'4'});view.snapshot.request=requestFor(doc,'synthesize');
 const project=parseProject(serialiseProject([doc],doc.id,new Map([[doc.id,view]]),'0.14.0'));
 assert.deepEqual(project.views.get(doc.id).response.model.synthesis,response.model.synthesis);assert.equal(project.views.get(doc.id).tab,'synthesis');assert.ok(resultIsCurrent(project.documents[0],project.views.get(doc.id).snapshot));
 project.documents[0].options.phaseTrajectories='8';assert.equal(resultIsCurrent(project.documents[0],project.views.get(doc.id).snapshot),false);
});
test('inconsistent witness values, phase assignments and nonfinite results are rejected',()=>{
 for(const mutate of [s=>s.values[0].value=2,s=>s.equilibria[0].jacobian[0].pop(),s=>s.phasePortrait.trajectories[0].finalDistance=2,s=>s.phasePortrait.trajectories[0].nearestEquilibrium=1,s=>s.phasePortrait.equilibriumX[0]=9,s=>s.equilibria[0].maximumRealEigenvalue=Infinity,s=>s.status='UNSAT',s=>s.values.push(s.values[0])]){const s=synthesis();mutate(s);assert.throws(()=>readSynthesis(s,['X','Y']));}
});
test('UNSAT and UNKNOWN are distinct outcomes without invented equilibria or code',()=>{
 for(const status of ['UNSAT','UNKNOWN']){const s={...synthesis(),status,values:[],equilibria:[],phasePortrait:null,code:null};assert.equal(readSynthesis(s,['X','Y']).status,status);assert.throws(()=>readSynthesis({...s,dispersion:{}},['X','Y']));}
});
test('Turing saved results require a matching squared wave number and dispersion witness',()=>{
 const s={...synthesis(),mode:'turing',values:[{name:'X',kind:'equilibrium',value:1,lowerBound:null,upperBound:null},{name:'Y',kind:'equilibrium',value:1,lowerBound:null,upperBound:null},{name:'wc',kind:'auxiliary',value:.25,lowerBound:null,upperBound:null}],equilibria:[synthesis().equilibria[0]],phasePortrait:null,dispersion:{waveNumbers:[0,.5,1],growthRates:[-1,.2,-2],witnessWaveNumber:.5,witnessGrowthRate:.2}};
 assert.equal(readSynthesis(s,['X','Y']).dispersion.witnessWaveNumber,.5);
 const bad=clone(s);bad.dispersion.witnessGrowthRate=.3;assert.throws(()=>readSynthesis(bad,['X','Y']));
 assert.match(dispersionSvg(s),/J − q²D/);assert.match(dispersionSvg(s),/Synthesized witness/);
});
test('Jacobian edges use column as source and row as destination',()=>{const output=jacobianSvg(synthesis());assert.match(output,/X → Y: 1/);assert.doesNotMatch(output,/Y → X/);});
test('SVG labels are escaped and phase coordinates remain finite',()=>{const s=synthesis();s.phasePortrait.speciesX='<script>alert(1)</script>';const output=phaseSvg(s);assert.match(output,/&lt;script&gt;/);assert.doesNotMatch(output,/<script|NaN|Infinity/);assert.match(output,/Initial \(0.5, 0.5\)/);});
test('CSV preserves exact trajectory, residual and witness values',()=>{const s=synthesis();s.values[0].value=1.2345678901234567;const output=synthesisCsv(s);assert.match(output,/1.2345678901234567/);assert.match(output,/"trajectory","1","1","","0","","","0.5","0.5"/);assert.match(output,/"residual"/);});
test('old saved results remain readable and synthesis metadata cannot appear in a parse result',()=>{const{response}=fixture();assert.throws(()=>readResponse({...response,operation:'parse'}));delete response.model.synthesis;assert.throws(()=>readResponse(response));assert.ok(readResponse({...response,operation:'parse'}));});
