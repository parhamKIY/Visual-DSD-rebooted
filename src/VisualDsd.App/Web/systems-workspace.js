import {systemsLessons,systemLesson,systemSource,termExercises,systemsReferences} from './systems-lessons.js';
import {systemsKey,emptySystemsWorkspace,readSystemsWorkspace,readSystemsPlan,newSystemsStudy,collectSystemsCurve,systemsSummary,systemsComparison,systemsInvariant,systemsCsv} from './systems.js';
import {systemsReport,systemsExerciseFiles,termExerciseFiles} from './systems-export.js';
import {zipFiles} from './course-export.js';
import {SimulationChart} from './chart.js';
const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value!=null)n.textContent=value;if(cls)n.className=cls;return n;};
const number=v=>v==null?'—':new Intl.NumberFormat('en',{maximumFractionDigits:5,notation:'standard'}).format(v);
export class SystemsWorkspace{
  constructor(dialog,hooks){
    this.dialog=dialog;this.h=hooks;this.page='catalog';
    try{this.state=readSystemsWorkspace(JSON.parse(localStorage.getItem(systemsKey)));}catch(error){this.state=emptySystemsWorkspace();this.restoreIssue=error.message;}
  }
  t(en,fa){return this.h.language()==='fa'?fa:en;}
  local(value){return value[this.h.language()==='fa'?'fa':'en'];}
  snapshot(){return readSystemsWorkspace(this.state);}
  persist(){try{localStorage.setItem(systemsKey,JSON.stringify(this.state));if(this.storage)this.storage.textContent=this.t('Saved in this browser; download for a portable copy.','در این مرورگر ذخیره شد؛ برای نسخهٔ قابل‌انتقال، فایل بگیر.');}catch{if(this.storage)this.storage.textContent=this.t('Session only. Download before closing this page.','فقط این نشست؛ پیش از بستن صفحه، فایل بگیر.');}}
  replace(raw){if(this.running)throw new Error('Stop the systems comparison before replacing it.');this.state=readSystemsWorkspace(raw);this.pendingLesson=null;this.persist();if(this.dialog.open)this.build();}
  button(id,label,action,parent,primary=false){const b=el('button',label,`button ${primary?'primary':'secondary'} compact`);b.id=id;b.type='button';b.addEventListener('click',async()=>{try{await action();}catch(error){this.message(error);}});parent.append(b);return b;}
  message(error){this.status.hidden=false;this.status.textContent=error.message??String(error);}
  open(page='catalog'){this.page=page;this.build();if(!this.dialog.open)this.dialog.showModal();}
  chooseLesson(id,replace=false){
    if(this.running)return;
    if(id!==this.state.lessonId&&(this.state.study||Object.values(this.state.notes).some(Boolean))&&!replace){this.pendingLesson=id;this.page='systems';this.build();return;}
    if(id!==this.state.lessonId){const plan=this.state.plan;this.state={...emptySystemsWorkspace(),lessonId:id,plan};this.persist();}
    this.pendingLesson=null;this.species=null;this.condition=null;this.page='systems';this.build();
  }
  build(){
    const fa=this.h.language()==='fa';this.dialog.lang=fa?'fa':'en';this.dialog.dir=fa?'rtl':'ltr';this.dialog.replaceChildren();
    const header=el('header',null,'logic-heading'),title=el('h2',this.t('Course exercises & systems biology','تمرین‌های درس و زیست‌شناسی سامانه‌ای'));title.id='systems-title';header.append(title);
    this.button('systems-close',this.t('Return to workspace','بازگشت به محیط'),()=>this.dialog.close(),header);this.dialog.append(header);
    const body=el('div',null,'logic-body');this.dialog.append(body);const nav=el('nav',null,'sequence-tabs');
    for(const [page,en,per] of [['catalog','Course exercises','تمرین‌های درس'],['systems','Systems biology lab','آزمایشگاه سامانه‌ها']]){const b=this.button(`systems-tab-${page}`,this.t(en,per),()=>{this.page=page;this.build();},nav);b.setAttribute('aria-pressed',String(this.page===page));}body.append(nav);
    this.status=el('p',null,'systems-status');this.status.setAttribute('role','status');this.status.hidden=true;body.append(this.status);
    if(this.restoreIssue){this.message(this.t('Saved systems workspace could not be restored: ','بازیابی میز کار ذخیره‌شده ممکن نشد: ')+this.restoreIssue);}
    if(this.page==='catalog'){this.catalog(body);return;}
    this.lab(body);this.setBusy();this.renderResults();
  }
  catalog(body){
    body.append(el('p',this.t('Pick an independent activity. Every exercise has a goal, a route through the tools, and a check for your own interpretation. Bundled examples are authored teaching data.','یک فعالیت مستقل انتخاب کن؛ هر تمرین هدف، مسیر ابزارها و معیار بررسی تفسیر خودت را دارد. نمونه‌ها، دادهٔ آموزشی تألیفی‌اند.')));
    const actions=el('div',null,'logic-actions');this.button('course-download',this.t('Download term exercise pack','دانلود بستهٔ تمرین‌های ترم'),()=>this.h.download('course-exercises.zip',zipFiles(termExerciseFiles()),'application/zip'),actions);body.append(actions);
    const grid=el('div',null,'systems-catalog');for(const exercise of termExercises){const card=el('section',null,'systems-card');card.append(el('span',`${this.t('STAGE','مرحله')} ${exercise.stage}`,'eyebrow'),el('h3',this.local(exercise.title)),el('p',this.local(exercise.goal)));
      const detail=el('details');detail.append(el('summary',this.t('Run it & check your result','مسیر اجرا و معیار بررسی')),el('p',this.local(exercise.steps)),el('p',this.local(exercise.check)));card.append(detail);
      const b=this.button(`course-activity-${exercise.id}`,this.t('Open activity','باز کردن فعالیت'),()=>{if(this.h.busy())throw new Error(this.t('Wait for the current calculation.','منتظر پایان محاسبه بمان.'));if(exercise.action.startsWith('systems:'))return this.chooseLesson(exercise.id);this.dialog.close();this.h.activity(exercise.action);},card);b.disabled=this.h.busy();grid.append(card);
    }body.append(grid);
    body.append(el('p',this.t('This package covers the planned workspace activities. RNA-seq, NGS pipelines, proteomics and structure prediction need separate tools. NCBI access needs internet; MUSCLE is optional.','این بسته فعالیت‌های برنامه‌ریزی‌شدهٔ محیط را پوشش می‌دهد. تحلیل گستردهٔ بیان ژن، خط پردازش دادهٔ نسل جدید، پروتئومیکس و پیش‌بینی ساختار به ابزار جدا نیاز دارند. دریافت پایگاه داده اینترنت می‌خواهد و ابزار هم‌ترازی مستقل اختیاری است.'),'muted'));
  }
  lab(body){
    this.planInvalid=false;
    const actions=el('div',null,'logic-actions');
    this.lessonSelect=el('select');this.lessonSelect.id='systems-lesson';for(const lesson of systemsLessons){const o=el('option',this.local(lesson.title));o.value=lesson.id;this.lessonSelect.append(o);}this.lessonSelect.value=this.state.lessonId;this.lessonSelect.addEventListener('change',()=>this.chooseLesson(this.lessonSelect.value));actions.append(this.lessonSelect);
    this.button('systems-save',this.t('Save lab file','ذخیرهٔ فایل آزمایش'),()=>this.h.download('workspace.systems.json',JSON.stringify(this.snapshot(),null,2),'application/json'),actions);
    const file=el('input');file.type='file';file.accept='.json';file.hidden=true;file.id='systems-file';file.addEventListener('change',async()=>{try{if(this.running||this.h.busy())throw new Error('Wait for the current calculation.');const selected=file.files?.[0];if(!selected)return;if(selected.size>8*1024*1024)throw new Error('Lab file exceeds 8 MiB.');const parsed=readSystemsWorkspace(JSON.parse(await selected.text()));if(this.running||this.h.busy())throw new Error('Wait for the current calculation.');this.replace(parsed);this.message(this.t('Lab restored, including retained requests, seeds and results.','آزمایش همراه درخواست‌ها، بذرها و نتیجه‌های نگهداری‌شده بازیابی شد.'));}catch(error){this.message(error);}finally{file.value='';}});actions.append(file);this.importButton=this.button('systems-import',this.t('Open lab file','باز کردن فایل آزمایش'),()=>file.click(),actions);
    this.button('systems-package',this.t('Export lab package','خروجی بستهٔ آزمایش'),()=>this.h.download('systems-exercise.zip',zipFiles(systemsExerciseFiles(this.snapshot(),{language:this.h.language()})),'application/zip'),actions);
    this.button('systems-report',this.t('Printable report','گزارش قابل چاپ'),()=>this.h.download('systems-report.html',systemsReport(this.snapshot(),{language:this.h.language()}),'text/html;charset=utf-8'),actions);body.append(actions);
    this.storage=el('p',null,'muted');body.append(this.storage);this.persist();
    if(this.pendingLesson){const pending=el('section',null,'systems-notice');pending.append(el('p',this.t('Changing lessons replaces this lab and its notes. Save the current lab or package above before continuing.','تغییر درس، این آزمایش و یادداشت‌هایش را جایگزین می‌کند؛ ابتدا فایل یا بستهٔ فعلی را ذخیره کن.')));this.button('systems-change-confirm',this.t('Replace with selected lesson','جایگزینی با درس انتخاب‌شده'),()=>this.chooseLesson(this.pendingLesson,true),pending);this.button('systems-change-cancel',this.t('Keep current lab','نگهداری آزمایش فعلی'),()=>{this.pendingLesson=null;this.build();},pending);body.append(pending);}
    const lesson=systemLesson(this.state.lessonId),guide=el('section',null,'systems-guide');guide.append(el('h3',this.local(lesson.title)),el('p',this.local(lesson.goal)));
    const list=el('ol');for(const step of lesson.steps)list.append(el('li',this.local(step)));guide.append(list);
    const assumptions=el('details');assumptions.append(el('summary',this.t('Model, equations & assumptions','مدل، معادله‌ها و فرض‌ها')),el('p',this.local(lesson.assumptions)),el('pre',lesson.equations));for(const c of lesson.conditions){assumptions.append(el('h4',this.local(c.label)),el('pre',systemSource(lesson.id,c.id)));this.button(`systems-source-${c.id}`,this.t('Open editable CRN copy','باز کردن نسخهٔ قابل‌ویرایش مدل'),()=>{if(this.h.busy())throw new Error('Wait for the current calculation.');this.dialog.close();this.h.source(`${lesson.id}-${c.id}.crn`,systemSource(lesson.id,c.id));},assumptions);}guide.append(assumptions);body.append(guide);
    const form=el('fieldset',null,'systems-plan');this.planFieldset=form;form.append(el('legend',this.t('Deterministic + repeated stochastic comparison','مقایسهٔ قطعی و تکرارهای تصادفی')));
    for(const [key,en,per,min,max] of [['repeats','SSA repeats per condition','تکرارهای تصادفی هر شرط',2,12],['seed','First seed','بذر نخست',0,2147483636]]){const label=el('label',this.t(en,per)),input=el('input');input.id=`systems-${key}`;input.type='number';input.required=true;input.min=min;input.max=max;input.step=1;input.value=this.state.plan[key];input.addEventListener('input',()=>{const values={repeats:Number(document.getElementById('systems-repeats').value),seed:Number(document.getElementById('systems-seed').value)};try{this.state.plan=readSystemsPlan(values);this.planInvalid=false;this.persist();}catch{this.planInvalid=true;}this.updateBudget();});label.append(input);form.append(label);}
    this.budget=el('p',null,'muted');form.append(this.budget);body.append(form);this.updateBudget();
    body.append(el('p',this.t('SSA scale=1 maps one stochastic copy to one model concentration unit; the engine axes remain nM and seconds. This is numerical population scaling, not an experimentally calibrated volume. Individual plots hold the last retained SSA value; the original solver samples are preserved in exports.','مقیاس تصادفی یک، هر کپی را به یک واحد غلظت مدل مرتبط می‌کند؛ محور موتور نانومولار و ثانیه باقی می‌ماند. این مقیاس عددی، حجم کالیبره‌شده نیست. نمودار منفرد آخرین مقدار نمونه‌برداری‌شده را نگه می‌دارد و نمونه‌های اصلی حل‌گر در خروجی حفظ می‌شوند.'),'systems-note'));
    const controls=el('div',null,'logic-actions');this.runButton=this.button('systems-run',this.t('Run ODE + SSA comparison','اجرای مقایسهٔ قطعی و تصادفی'),()=>this.run(false),controls,true);this.resumeButton=this.button('systems-resume',this.t('Continue unfinished runs','ادامهٔ اجراهای ناتمام'),()=>this.run(true),controls);this.stopButton=this.button('systems-stop',this.t('Stop comparison','توقف مقایسه'),()=>this.h.stop(),controls);body.append(controls);
    this.replacePanel=el('div',null,'systems-notice');this.replacePanel.hidden=true;this.replacePanel.append(el('p',this.t('A comparison is already retained. Save it before replacing it. Your notes remain editable.','یک مقایسه نگهداری شده است؛ پیش از جایگزینی آن را ذخیره کن. یادداشت‌ها قابل ویرایش‌اند.')));this.button('systems-replace',this.t('Replace comparison and run','جایگزینی مقایسه و اجرا'),()=>this.run(false,true),this.replacePanel);body.append(this.replacePanel);
    this.progress=el('p');this.progress.id='systems-progress';this.progress.setAttribute('role','status');body.append(this.progress);
    const selectors=el('div',null,'systems-selectors');this.species=lesson.species.includes(this.species)?this.species:lesson.focus;this.condition=lesson.conditions.some(c=>c.id===this.condition)?this.condition:lesson.conditions[0].id;
    this.addSelect('systems-condition',this.t('Condition','شرط'),lesson.conditions.map(c=>[c.id,this.local(c.label)]),this.condition,value=>{this.condition=value;this.updateTraces();},selectors);
    this.addSelect('systems-species',this.t('Species','گونه'),lesson.species.map(n=>[n,n]),this.species,value=>{this.species=value;this.renderResults();},selectors);
    this.traceSelect=this.addSelect('systems-trace',this.t('Plot','نمودار'),[['summary',this.t('ODE and SSA mean ± sample SD','قطعی و میانگین تصادفی با انحراف معیار نمونه')]],'summary',()=>this.draw(),selectors);body.append(selectors);
    this.chartTitle=el('h3');body.append(this.chartTitle);const wrap=el('div',null,'systems-chart');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='systems-chart';svg.setAttribute('aria-label',this.t('ODE and SSA population comparison','مقایسهٔ جمعیت قطعی و تصادفی'));const legend=el('div',null,'chart-legend'),tooltip=el('div',null,'chart-tooltip');tooltip.hidden=true;wrap.append(svg,tooltip);body.append(wrap,legend);this.chart=new SimulationChart(svg,legend,tooltip);
    const exports=el('div',null,'logic-actions');this.csvButton=this.button('systems-csv',this.t('Original trajectories CSV','دادهٔ مسیرهای اصلی'),()=>this.h.download('systems-trajectories.csv',systemsCsv(this.state.study),'text/csv;charset=utf-8'),exports);this.svgButton=this.button('systems-svg',this.t('Current plot SVG','تصویر برداری نمودار فعلی'),()=>this.h.download('systems-plot.svg',this.chart.exportSvg(),'image/svg+xml'),exports);body.append(exports);
    body.append(el('p',this.t('The shaded region is ±1 sample SD across completed repeats, not a confidence interval or the complete distribution. Summaries below use the requested endpoint, taking the last retained SSA value within the original solver’s tiny final-output tolerance; its exact timestamp appears in Recorded runs. This is not a stationary window. Failed, cancelled and unfinished runs are unavailable, never zeros.','ناحیهٔ سایه‌دار یک انحراف معیار نمونه از تکرارهای کامل است؛ فاصلهٔ اطمینان یا کل توزیع نیست. خلاصه مربوط به زمان پایان درخواستی است؛ آخرین مقدار تصادفی در تلورانس بسیار کوچک خروجی نهایی موتور استفاده می‌شود و زمان دقیقش در جزئیات اجرا ثبت است. این پنجرهٔ ایستا نیست. اجرای شکست‌خورده، لغوشده یا ناتمام، ناموجود است و صفر محسوب نمی‌شود.'),'systems-note'));
    this.results=el('div',null,'table-wrap');this.results.id='systems-summary';body.append(this.results);this.details=el('details');this.details.append(el('summary',this.t('Recorded runs, seeds & conservation checks','اجراهای ثبت‌شده، بذرها و پایستگی')));this.runRows=el('div',null,'table-wrap');this.runRows.id='systems-runs';this.details.append(this.runRows);body.append(this.details);
    const questions=el('section',null,'systems-guide');questions.append(el('h3',this.t('Check and explain','بررسی و توضیح')),el('p',this.local(lesson.check)));const q=el('ol');for(const question of lesson.questions)q.append(el('li',this.local(question)));questions.append(q);body.append(questions);
    for(const [key,en,per] of [['hypothesis','My hypothesis','فرضیهٔ من'],['observations','My observations','مشاهده‌های من'],['interpretation','My interpretation & limitations','تفسیر و محدودیت‌ها']]){const label=el('label',this.t(en,per),'systems-answer'),input=el('textarea');input.id=`systems-${key}`;input.maxLength=8000;input.rows=3;input.value=this.state.notes[key];input.addEventListener('input',()=>{this.state.notes[key]=input.value;this.persist();});label.append(input);body.append(label);}
    const refs=el('details');refs.append(el('summary',this.t('Background sources; these toy rates are not fitted to the papers','منابع تکمیلی؛ نرخ‌های آموزشی به مقاله‌ها برازش نشده‌اند')));for(const r of systemsReferences){const p=el('p'),a=el('a',r.title);a.href=r.url;a.target='_blank';a.rel='noopener';p.append(a);refs.append(p);}body.append(refs);
  }
  addSelect(id,label,items,value,change,parent){const wrap=el('label',label),select=el('select');select.id=id;for(const [v,name] of items){const option=el('option',name);option.value=v;select.append(option);}select.value=value;select.addEventListener('change',()=>change(select.value));wrap.append(select);parent.append(wrap);return select;}
  updateBudget(){if(this.budget)this.budget.textContent=this.planInvalid?this.t('Enter valid whole numbers.','عدد صحیح معتبر وارد کن.'):`${systemLesson(this.state.lessonId).conditions.length*(this.state.plan.repeats+1)} ${this.t('sequential runs; 30 s deadline per run; no automatic resubmission.','اجرای پیاپی؛ مهلت هر اجرا ۳۰ ثانیه؛ بدون ارسال دوبارهٔ خودکار.')}`;}
  setBusy(){const busy=this.running||this.h.busy();this.lessonSelect.disabled=busy;this.importButton.disabled=busy;this.planFieldset.disabled=busy;this.runButton.disabled=busy;this.resumeButton.disabled=busy;this.stopButton.hidden=!this.running;}
  refreshBusy(){if(!this.dialog.open)return;if(this.page==='systems')this.setBusy();else for(const b of this.dialog.querySelectorAll('[id^="course-activity-"]'))b.disabled=this.h.busy();}
  updateTraces(){const selected=this.traceSelect.value;this.traceSelect.replaceChildren();const summary=el('option',this.t('ODE and SSA mean ± sample SD','قطعی و میانگین تصادفی با انحراف معیار نمونه'));summary.value='summary';this.traceSelect.append(summary);for(const r of this.state.study?.runs??[])if(r.conditionId===this.condition&&r.simulator==='ssa'&&r.state==='succeeded'){const o=el('option',`SSA · seed ${r.seed}`);o.value=String(r.seed);this.traceSelect.append(o);}this.traceSelect.value=[...this.traceSelect.options].some(o=>o.value===selected)?selected:'summary';this.draw();}
  table(headers,rows){const table=el('table'),thead=el('thead'),tr=el('tr');for(const h of headers)tr.append(el('th',h));thead.append(tr);table.append(thead);const tbody=el('tbody');for(const values of rows){const row=el('tr');for(const v of values)row.append(el('td',String(v)));tbody.append(row);}table.append(tbody);return table;}
  renderResults(){
    if(this.page!=='systems')return;const study=this.state.study;this.results.replaceChildren();this.runRows.replaceChildren();this.csvButton.disabled=!study;this.resumeButton.hidden=!study||!study.runs.some(r=>['queued','running','admitting'].includes(r.state));
    const changed=study&&JSON.stringify(study.plan)!==JSON.stringify(this.state.plan);this.progress.textContent=study?`${study.runs.filter(r=>r.state==='succeeded').length}/${study.runs.length} ${this.t('completed','کامل')} · engine ${study.engineVersion} · ${study.createdAt}${changed?this.t(' · Plan changed; retained results use the recorded plan.',' · برنامه تغییر کرده؛ نتایج مربوط به برنامهٔ ثبت‌شده‌اند.'):''}`:this.t('No comparison has been run.','هنوز مقایسه‌ای اجرا نشده است.');
    if(study){this.results.append(this.table([this.t('Condition','شرط'),'ODE',this.t('SSA n / requested','تکرار کامل از درخواستی'),this.t('Unavailable','ناموجود'),this.t('Mean','میانگین'),'SD','CV','Fano'],systemsSummary(study,this.species).map(s=>[s.conditionId,number(s.deterministic),`${s.n}/${s.requested}`,s.unavailable,number(s.mean),number(s.sd),number(s.cv),number(s.fano)])));
      this.runRows.append(this.table([this.t('Condition','شرط'),this.t('Solver','حل‌گر'),this.t('Repeat','تکرار'),this.t('Seed','بذر'),this.t('State','وضعیت'),this.t('Job / diagnostic','شناسه و پیام'),this.t('Invariant max error','بیشترین خطای پایستگی'),this.t('Last original sample (s)','آخرین نمونهٔ اصلی؛ ثانیه')],study.runs.map(r=>{const invariant=systemsInvariant(r,study.lessonId);return [r.conditionId,r.simulator,r.repeat,r.seed??'—',r.state,[r.jobId,r.message].filter(Boolean).join(' · ')||'—',invariant?`${invariant.expression} · ${number(invariant.maxAbsoluteError)}`:'—',r.curve?.times.at(-1)??'—'];})));
    }this.updateTraces();
  }
  draw(){const study=this.state.study,kind=this.traceSelect.value;const run=study?systemsComparison(study,this.condition,kind==='summary'?this.species:{seed:kind,species:this.species},kind==='summary'?'summary':'individual'):{times:[],series:[]};this.chart.setRun(run,{timeUnit:'s',concentrationUnit:'nM'});this.svgButton.disabled=!run.times.length;this.chartTitle.textContent=`${this.condition} · ${this.species} · ${this.t('endpoint','انتهای زمان')} ${systemLesson(this.state.lessonId).final} s`;}
  async run(resume,replace=false){
    if(this.running||this.h.busy())return this.message(this.t('Wait for the current calculation.','منتظر پایان محاسبه بمان.'));
    if(this.planInvalid||this.planFieldset.querySelector(':invalid')){this.planFieldset.querySelector(':invalid')?.reportValidity();return;}
    try{
      if(this.h.version()==='unknown')throw new Error('Wait for the service version.');
      if(!resume&&this.state.study&&!replace){this.replacePanel.hidden=false;return;}
      if(resume&&(!this.state.study||JSON.stringify(this.state.plan)!==JSON.stringify(this.state.study.plan)||this.h.version()!==this.state.study.engineVersion))throw new Error(this.t('Plan or engine version changed. Export this lab and start a new comparison.','برنامه یا نسخهٔ موتور تغییر کرده؛ آزمایش فعلی را ذخیره و مقایسهٔ تازه شروع کن.'));
      if(!resume)this.state.study=newSystemsStudy(this.state.lessonId,this.state.plan,this.h.version());
      const study=this.state.study;this.running=true;this.persist();this.replacePanel.hidden=true;this.status.hidden=true;this.setBusy();this.renderResults();
      await this.h.session(async(execute,task)=>{
        for(const row of study.runs){
          if(task.cancelling)break;if(!['queued','running','admitting'].includes(row.state))continue;
          if(row.state==='admitting'&&!row.jobId){row.state='interrupted';row.message='Admission outcome is unknown; inspect Jobs. No automatic resubmission.';this.persist();continue;}
          try{
            if(!row.jobId){row.state='admitting';this.persist();}this.renderResults();
            const job=await execute(row.request,row);
            if(job.engineVersion!==study.engineVersion)throw new Error('Calculation engine differs from the recorded study.');
            if(job.state==='succeeded'&&job.result?.success){row.curve=collectSystemsCurve(job.result,row,study.lessonId);row.engineVersion=job.engineVersion;row.state='succeeded';}
            else{row.state=['cancelled','timedOut','interrupted'].includes(job.state)?job.state:'failed';row.message=(job.result?.diagnostics?.map(d=>`${d.code}: ${d.message}`).join('\n')||job.state).slice(0,4096);}
          }catch(error){row.state='interrupted';row.message=error.message.slice(0,4096);delete row.curve;task.cancelling=true;}
          this.persist();this.renderResults();
        }
      });this.state=readSystemsWorkspace(this.state);
    }catch(error){this.message(error);}finally{this.running=false;this.persist();this.setBusy();this.renderResults();}
  }
}
