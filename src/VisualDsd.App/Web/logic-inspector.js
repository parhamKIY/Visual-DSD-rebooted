import { readAnalysisWindow, sampleAt, readout } from './logic.js';
import { logicSignals, logicGraph, caseMetrics, batchMetrics, metricsCsv } from './logic-analysis.js';
import { rateLabel } from './model.js';

const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const svg=(tag,attrs={},text)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text!=null)e.textContent=text;return e;};
const number=x=>x==null?'—':rateLabel(Number(x.toPrecision(6)).toString());
const words={
 focus:['Focus selected traces','بزرگ‌نمایی منحنی‌های منتخب'],showAll:['Show all traces','نمایش همهٔ منحنی‌ها'],badges:['Output badges show expected / observed bits at the read time; ? means unknown.','برچسب خروجی، بیت مورد انتظار و سپس بیت مشاهده‌شده در زمان خواندن را نشان می‌دهد؛ علامت سؤال یعنی نامعین.'],observed:['Observed','مشاهده‌شده'],
 heading:['Follow a signal','دنبال کردن سیگنال'],guide:['Select a logic node, molecule, curve or curve label to highlight the same signal across these views.','یک گره منطقی، مولکول، منحنی یا نام منحنی را انتخاب کن تا همان سیگنال در این نماها برجسته شود.'],
 logic:['Expected Boolean function','تابع منطقی مورد انتظار'],logicalOnly:['Internal nodes represent the function you entered; molecular compiler stages are described by the source model.','گره‌های داخلی، تابعی را که وارد کرده‌ای نشان می‌دهند؛ مراحل مولکولی کامپایلر در کد مدل تعریف شده‌اند.'],unmapped:['This Boolean node has no molecular mapping. Choose an input or output to inspect its rails.','این گره منطقی نگاشت مولکولی ندارد؛ برای دیدن مسیرها، یک ورودی یا خروجی را انتخاب کن.'],
 molecules:['Mapped molecules','مولکول‌های نگاشت‌شده'],input:['Input','ورودی'],output:['Output','خروجی'],rail:['rail','مسیر'],selected:['Selected','انتخاب‌شده'],initial:['Initial input concentration','غلظت اولیهٔ ورودی'],atRead:['Concentration at read time','غلظت در زمان خواندن'],missing:['This saved case has no trajectory for this molecule. New batches record input and output rails.','برای این مولکول در این حالت نموداری ذخیره نشده است؛ آزمایش‌های جدید مسیرهای ورودی و خروجی را ثبت می‌کنند.'],inputNote:['Input bits specify initial concentrations; molecular inputs may be consumed during the simulation.','بیت‌های ورودی، غلظت اولیه را مشخص می‌کنند؛ ورودی‌های مولکولی ممکن است طی شبیه‌سازی مصرف شوند.'],
 metrics:['Signal quality & response','کیفیت سیگنال و زمان پاسخ'],window:['Measurement window','بازهٔ اندازه‌گیری'],start:['Window starts at','شروع بازه'],end:['Window ends at','پایان بازه'],export:['Metrics CSV ↓','دریافت معیارها'],definitions:['How these metrics are calculated','روش محاسبهٔ معیارها'],
 peakHelp:['Leakage is the maximum concentration of the rail intended to be OFF during the window. Single-rail ON cases have no OFF rail, so leakage is not applicable. Dual-rail cases use the complementary OFF rail.','نشتی، بیشترین غلظت مسیری است که باید در بازه خاموش باشد. برای خروجی روشنِ تک‌خطی، نشتی تعریف نشده است؛ در حالت دوخطی مسیر مکملِ خاموش سنجیده می‌شود.'],
 marginHelp:['Margin is measured at the experiment read time: OFF = low − concentration; ON = concentration − high. For dual rails, take the smaller of the ON and OFF margins. Zero is on the accepted boundary; a negative value violates a required threshold.','فاصله از آستانه در زمان خواندن آزمایش محاسبه می‌شود: برای خاموش، آستانهٔ پایین منهای غلظت؛ برای روشن، غلظت منهای آستانهٔ بالا. در حالت دوخطی، مقدار کوچک‌ترِ دو فاصله گزارش می‌شود. صفر روی مرز پذیرفته‌شده است و مقدار منفی یعنی یکی از شرط‌های آستانه برقرار نیست.'],
 responseHelp:['Sustained response is the last entry into the expected logical region that stays valid through the window end, reported as delay from the window start. Already valid throughout = 0. Invalid at the window end = not reached. This is a threshold settling measure, not a 10–90% rise time.','زمان پاسخ پایدار، آخرین ورود به ناحیهٔ منطقی مورد انتظار است که تا پایان بازه معتبر می‌ماند؛ مقدار گزارش‌شده تأخیر نسبت به شروع بازه است. اگر خروجی از ابتدا تا انتها معتبر باشد، مقدار صفر است. اگر در پایان معتبر نباشد، زمان پاسخ در این بازه به دست نیامده است. این معیار، زمان نشست نسبت به آستانه است.'],
 sampling:['Calculations use saved samples and linear interpolation. Transients between recorded samples are unobserved. Changing this window recalculates metrics without running the model again.','محاسبات از نمونه‌های ذخیره‌شده و درون‌یابی خطی استفاده می‌کنند؛ رفتارهای گذرای میان نمونه‌ها دیده نمی‌شوند. تغییر این بازه، معیارها را بدون اجرای دوباره محاسبه می‌کند.'],
 outputName:['Output','خروجی'],expected:['Expected','مورد انتظار'],leakage:['OFF-rail peak','بیشینهٔ مسیر خاموش'],margin:['Margin at read time','فاصله در زمان خواندن'],response:['Sustained response delay','تأخیر پاسخ پایدار'],atStart:['Valid throughout window','در تمام بازه معتبر'],reached:['Reached and sustained','رسیده و پایدار'],notReached:['Not reached in window','در این بازه نرسیده'],na:['Not applicable','تعریف نشده'],unavailable:['No completed trajectory available for this case','برای این حالت نمودار کامل در دسترس نیست'],
 summary:['Across completed cases','در میان حالت‌های کامل'],coverage:['Cases with available measurements','حالت‌های دارای اندازه‌گیری'],worstLeak:['Largest OFF-rail peak','بزرگ‌ترین بیشینهٔ مسیر خاموش'],worstMargin:['Smallest read-time margin','کمترین فاصله در زمان خواندن'],slowest:['Longest reached response delay','بیشترین تأخیر پاسخِ به‌دست‌آمده'],notReachedCount:['not reached','نرسیده'],case:['case','حالت'],time:['time','زمان'],snapshot:['Measurements use the recorded experiment settings and curves.','اندازه‌گیری‌ها بر پایهٔ تنظیمات ثبت‌شده و نمودارهای همان آزمایش‌اند.']};

export class LogicInspector {
  constructor(root,chart,hooks){
    this.root=root;this.chart=chart;this.h=hooks;
    this.title=node('h4');this.help=node('p','exploration-note');this.selection=node('p','logic-selection');this.focusButton=node('button','button secondary compact');this.focusButton.type='button';this.focusButton.addEventListener('click',()=>{this.focused=!this.focused;this.select(this.selectedKey,this.selectedStructure);});
    this.layout=node('div','logic-linked-layout');
    const logical=node('section','logic-logic-view');this.logicTitle=node('h5');this.diagram=node('div','logic-diagram');this.note=node('p','exploration-note');logical.append(this.logicTitle,this.diagram,this.note);
    const molecular=node('section');this.moleculeTitle=node('h5');this.cards=node('div','logic-molecule-cards');this.inputNote=node('p','exploration-note');molecular.append(this.moleculeTitle,this.cards,this.inputNote);this.layout.append(logical,molecular);
    this.metrics=node('section','logic-metrics');this.metricsTitle=node('h4');this.controls=node('div','logic-analysis-controls');this.start=node('input');this.end=node('input');this.start.type=this.end.type='number';this.start.step=this.end.step='any';this.start.dataset.analysisBound='start';this.end.dataset.analysisBound='end';
    this.startLabel=node('label');this.endLabel=node('label');this.startText=node('span');this.endText=node('span');this.startLabel.append(this.startText,this.start);this.endLabel.append(this.endText,this.end);this.exportButton=node('button','button secondary compact');this.exportButton.type='button';this.controls.append(this.startLabel,this.endLabel,this.exportButton);
    this.windowMessage=node('p','logic-message');this.windowMessage.setAttribute('role','status');this.windowMessage.hidden=true;
    this.description=node('details','logic-metric-definitions');this.definitionTitle=node('summary');this.definitions=['peakHelp','marginHelp','responseHelp','sampling'].map(()=>node('p'));this.description.append(this.definitionTitle,...this.definitions);
    this.measurements=node('div','data-table');this.summary=node('div','logic-metric-summary');this.snapshot=node('p','exploration-note');this.metrics.append(this.metricsTitle,this.controls,this.windowMessage,this.description,this.measurements,this.summary,this.snapshot);
    root.append(this.title,this.help,this.selection,this.focusButton,this.layout,this.metrics);
    for(const input of [this.start,this.end])input.addEventListener('input',()=>this.changeWindow());
    this.exportButton.addEventListener('click',()=>{if(this.validWindow())this.h.download('logic-metrics.csv',metricsCsv(this.batch),'text/csv;charset=utf-8');});
  }
  t(key){return words[key]?.[this.h.language()==='fa'?1:0]??key;}
  bitText(row=this.row){return row?this.batch.config.inputs.map((i,n)=>`${i.name}=${row.bits[n]}`).join(', '):'';}
  render(batch,row,previews=[]){
    const changed=this.batch?.id!==batch.id;this.batch=batch;this.row=row;this.signals=logicSignals(batch.config);this.previews=batch.molecules??previews;
    this.root.hidden=false;this.title.textContent=this.t('heading');this.help.textContent=this.t('guide');this.logicTitle.textContent=this.t('logic');this.note.textContent=this.t('logicalOnly')+' '+this.t('badges');this.moleculeTitle.textContent=this.t('molecules');this.inputNote.textContent=this.t('inputNote');this.metricsTitle.textContent=this.t('metrics');this.startText.textContent=`${this.t('start')} (${batch.config.timeUnit})`;this.endText.textContent=`${this.t('end')} (${batch.config.timeUnit})`;this.exportButton.textContent=this.t('export');this.definitionTitle.textContent=this.t('definitions');this.definitions.forEach((p,i)=>p.textContent=this.t(['peakHelp','marginHelp','responseHelp','sampling'][i]));this.snapshot.textContent=this.t('snapshot');
    const window=batch.analysis??{start:0,end:batch.config.time};if(changed){this.start.value=window.start;this.end.value=window.end;this.start.setCustomValidity('');this.end.setCustomValidity('');this.windowMessage.hidden=true;this.selectedKey=`outputs:${batch.config.outputs[0].name}`;this.selectedStructure=null;}
    this.drawGraph();this.drawMolecules();
    const curve=row?.curve;
    const series=curve?.series.map(s=>({...s,name:this.signalName(s.name)}))??[];
    this.chart.setRun({times:curve?.times??[],series,mode:curve?.mode},{simulator:batch.execution?.simulator??'oslo',timeUnit:batch.config.timeUnit,concentrationUnit:batch.config.unit});
    this.select(this.selectedKey,this.selectedStructure);this.renderMetrics();
  }
  signalName(structure){return this.signals.flatMap(s=>s.rails.filter(r=>r.structure===structure).map(r=>`${this.t(s.kind==='inputs'?'input':'output')} ${s.name}${s.rails.length>1?' · '+this.t('rail')+' '+r.rail:''}`)).join(' / ')||structure;}
  drawGraph(){
    const graph=logicGraph(this.batch.config,this.row?.bits);this.graph=graph;
    const picture=svg('svg',{viewBox:`0 0 ${graph.width} ${graph.height}`,width:graph.width,height:graph.height,role:'group','aria-label':this.t('logic')});picture.style.minWidth=`${Math.max(500,graph.width*.65)}px`;
    const positions=new Map(graph.nodes.map(n=>[n.key,n])),verdict=this.row?readout(this.batch.config,this.row):{outputs:[]};
    for(const edge of graph.edges){const a=positions.get(edge.source),b=positions.get(edge.target),x=a.x+a.width,y=a.y+a.height/2,end=b.x,ey=b.y+b.height/2;picture.append(svg('path',{d:`M${x} ${y}C${(x+end)/2} ${y} ${(x+end)/2} ${ey} ${end} ${ey}`,class:'logic-wire','data-from':a.key,'data-to':b.key}),svg('path',{d:`M${end-6} ${ey-3}L${end} ${ey}L${end-6} ${ey+3}`,class:'logic-wire-arrow'}));}
    for(const item of graph.nodes){
      const label=item.kind==='input'?`${this.t('input')} ${item.label}`:item.kind==='output'?`${this.t('output')} ${item.label}`:item.label;
      const group=svg('g',{role:'button',tabindex:0,'aria-label':label,'aria-pressed':'false','data-logic-node':item.key});
      const observed=item.kind==='output'?verdict.outputs[this.batch.config.outputs.findIndex(o=>o.name===item.label)]:null;
      group.dataset.verdict=observed?.status??'';
      group.append(svg('title',{},item.kind==='output'?`${this.t('expected')}: ${item.value??'—'}; ${this.t('observed')}: ${observed?.observed??(observed?'?':'—')}`:item.label),svg('rect',{x:item.x,y:item.y,width:item.width,height:item.height,rx:item.kind==='output'?22:8,class:`logic-node logic-node-${item.kind}`}),svg('text',{x:item.x+item.width/2,y:item.y+21,'text-anchor':'middle',class:'logic-node-label'},item.label),svg('text',{x:item.x+item.width/2,y:item.y+38,'text-anchor':'middle',class:'logic-node-bit'},item.kind==='output'?`${item.value??'—'} / ${observed?.observed??(observed?'?':'—')}`:item.value??'—'));
      group.addEventListener('click',()=>this.select(item.key));group.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();this.select(item.key);}});picture.append(group);
    }
    this.diagram.dir='ltr';this.diagram.replaceChildren(picture);
  }
  drawMolecules(){
    this.cards.replaceChildren();let values=[];try{if(this.row?.curve)values=sampleAt(this.row.curve,this.batch.config.time);}catch{/* No measured value for an incomplete case. */}
    for(const signal of this.signals)for(const rail of signal.rails){
      const card=node('button','logic-molecule-card');card.type='button';card.dataset.signal=signal.key;card.dataset.structure=rail.structure;card.setAttribute('aria-pressed','false');
      const title=this.signalName(rail.structure);card.append(node('strong','',title));
      const molecule=this.previews.find(m=>m.structure===rail.structure);
      if(molecule?.svg){const image=node('img');image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(molecule.svg)}`;image.alt=rail.structure;card.append(image);}
      const structure=node('code','logic-molecule-structure',rail.structure);structure.dir='ltr';card.append(structure);
      if(signal.kind==='inputs'&&this.row){const input=this.batch.config.inputs[signal.index],bit=this.row.bits[signal.index],amount=bit===rail.rail?input.on:input.off;card.append(node('small','',`${this.t('initial')}: ${number(amount)} ${this.batch.config.unit}`));}
      const index=this.row?.curve?.series.findIndex(s=>s.name===rail.structure)??-1;
      card.append(node('small','',index>=0?`${this.t('atRead')}: ${number(values[index])} ${this.batch.config.unit}`:this.t('missing')));
      card.addEventListener('click',()=>this.select(signal.key,rail.structure));this.cards.append(card);
    }
  }
  select(key,structure=null){
    if(!this.graph.nodes.some(n=>n.key===key)){key=`outputs:${this.batch.config.outputs[0].name}`;structure=null;}
    this.selectedKey=key;this.selectedStructure=structure;
    const signal=this.signals.find(s=>s.key===key),mapped=new Set(structure?[structure]:signal?.rails.map(r=>r.structure)??[]);
    const keys=new Set(signal?this.signals.filter(s=>s.rails.some(r=>mapped.has(r.structure))).map(s=>s.key):[key]);
    for(const e of this.diagram.querySelectorAll('[data-logic-node]'))e.setAttribute('aria-pressed',String(keys.has(e.dataset.logicNode)));
    for(const e of this.diagram.querySelectorAll('[data-from]'))e.classList.toggle('selected',keys.has(e.dataset.from)||keys.has(e.dataset.to));
    for(const card of this.cards.querySelectorAll('button'))card.setAttribute('aria-pressed',String(mapped.has(card.dataset.structure)));
    const selectedCard=this.cards.querySelector('[aria-pressed=true]');
    if(selectedCard){const bounds=this.cards.getBoundingClientRect(),card=selectedCard.getBoundingClientRect();if(card.top<bounds.top||card.bottom>bounds.bottom)this.cards.scrollTop+=card.top-bounds.top;}
    const indices=this.row?.curve?.series.flatMap((s,i)=>mapped.has(s.name)?[i]:[])??[];
    if(!indices.length)this.focused=false;this.focusButton.disabled=!indices.length;this.focusButton.textContent=this.t(this.focused?'showAll':'focus');this.focusButton.setAttribute('aria-pressed',String(Boolean(this.focused)));
    const visible=new Set(this.focused?indices:this.row?.curve?.series.map((_,i)=>i)??[]);
    if(visible.size!==this.chart.visible.size||[...visible].some(i=>!this.chart.visible.has(i))){this.chart.visible=visible;this.chart.draw();}
    this.chart.highlight(indices);
    this.selection.textContent=signal?`${this.t('selected')}: ${structure?this.signalName(structure):this.t(signal.kind==='inputs'?'input':'output')+' '+signal.name} · ${this.bitText()}`:this.t('unmapped');
  }
  selectTrace(index){const structure=this.row?.curve?.series[index]?.name,signal=this.signals?.find(s=>s.key===this.selectedKey&&s.rails.some(r=>r.structure===structure))??this.signals?.find(s=>s.rails.some(r=>r.structure===structure));if(signal)this.select(signal.key,structure);}
  changeWindow(){
    try{
      if(this.start.value===''||this.end.value==='')throw new Error('Enter both analysis window bounds.');
      const window=readAnalysisWindow({start:Number(this.start.value),end:Number(this.end.value)},this.batch.config);
      this.start.setCustomValidity('');this.end.setCustomValidity('');this.batch.analysis=window;this.windowMessage.hidden=true;this.h.persist();
    }catch(error){this.start.setCustomValidity(error.message);this.end.setCustomValidity(error.message);this.windowMessage.textContent=error.message;this.windowMessage.hidden=false;}
    this.renderMetrics();
  }
  validWindow(){if(this.root.hidden)return true;const invalid=[this.start,this.end].find(i=>!i.checkValidity());if(invalid){invalid.reportValidity();return false;}return true;}
  renderMetrics(){
    this.measurements.replaceChildren();this.summary.replaceChildren();this.exportButton.disabled=![this.start,this.end].every(i=>i.checkValidity());if(this.exportButton.disabled)return;
    const config=this.batch.config,window=this.batch.analysis??{start:0,end:config.time},metrics=caseMetrics(config,this.row,window),summary=batchMetrics(this.batch);
    if(metrics.state==='available'){
      const table=node('table'),head=node('tr');for(const text of [this.t('outputName'),this.t('expected'),`${this.t('leakage')} (${config.unit})`,`${this.t('margin')} (${config.unit})`,`${this.t('response')} (${config.timeUnit})`])head.append(node('th','',text));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
      for(const m of metrics.outputs){const tr=node('tr');tr.append(node('td','',m.name),node('td','',String(m.expected)),node('td','',m.leakage?`${number(m.leakage.value)} · ${this.t('time')} ${number(m.leakage.time)} ${config.timeUnit}`:this.t('na')),node('td',m.margin<0?'logic-negative':'',number(m.margin)),node('td','',m.response.delay===null?this.t('notReached'):`${number(m.response.delay)} · ${this.t(m.response.status)}`));body.append(tr);}table.append(body);this.measurements.append(table);
    }else this.measurements.append(node('p','exploration-note',`${this.t('unavailable')} · ${metrics.state}${metrics.message?' · '+metrics.message:''}`));
    this.summary.append(node('h5','',this.t('summary')),node('p','exploration-note',`${this.t('coverage')}: ${summary.available} / ${summary.total} · ${window.start}–${window.end} ${config.timeUnit}`));
    const rowName=v=>v?`${this.t('case')} ${this.batch.cases[v.caseIndex].bits.join('')}`:'';
    for(const output of summary.outputs){const card=node('div','logic-summary-card');card.append(node('strong','',output.name),node('p','',`${this.t('worstLeak')}: ${output.maximumLeakage?number(output.maximumLeakage.leakage.value)+' '+config.unit+' · '+rowName(output.maximumLeakage):this.t('na')}`),node('p','',`${this.t('worstMargin')}: ${output.minimumMargin?number(output.minimumMargin.margin)+' '+config.unit+' · '+rowName(output.minimumMargin):'—'}`),node('p','',`${this.t('slowest')}: ${output.maximumResponse?number(output.maximumResponse.response.delay)+' '+config.timeUnit+' · '+rowName(output.maximumResponse):'—'} · ${output.notReached} ${this.t('notReachedCount')}`));this.summary.append(card);}
  }
}
