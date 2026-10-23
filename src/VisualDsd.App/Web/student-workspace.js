import { optionDefaults } from './model.js';
import { resultIsCurrent } from './project.js';

export const STUDENT_KEY = 'visual-dsd.student.v1';
export function readStudentPreferences(storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(STUDENT_KEY) || 'null');
    return { mode: saved?.mode === 'expert' ? 'expert' : 'student', screen: saved?.screen === 'workspace' ? 'workspace' : 'home' };
  } catch { return { mode: 'student', screen: 'home' }; }
}
export function writeStudentPreferences(preferences, storage) {
  try { (storage ?? globalThis.localStorage).setItem(STUDENT_KEY, JSON.stringify({ mode: preferences.mode === 'expert' ? 'expert' : 'student', screen: preferences.screen === 'workspace' ? 'workspace' : 'home' })); return true; }
  catch { return false; }
}

// Completion follows the current source AND settings, never a stale result or
// solver preview. Reading/downloading refers to this exact completed response.
export function studentJourney(model, view = {}) {
  const source = Boolean(model?.code.trim());
  const fresh = source && view.response?.success === true && Boolean(view.snapshot) && resultIsCurrent(model, view.snapshot);
  const issue = Boolean(view.diagnostics?.some(item => item.severity !== 'warning'));
  const checked = fresh && !issue;
  const simulated = checked && view.response.operation === 'simulate' && view.response.model.simulations.some(run => run.times.length > 0);
  const read = simulated && view.studentReadResponse === view.response;
  const downloaded = read && view.studentSavedResponse === view.response;
  const stage = !source ? 'source' : !checked ? 'check' : !simulated ? 'simulate' : !read ? 'read' : !downloaded ? 'save' : 'done';
  const overrides = model ? Object.keys(optionDefaults).filter(key => !['language', 'dialect', 'timeoutSeconds'].includes(key) && model.options[key] !== optionDefaults[key]).length : 0;
  return { stage, checked: Boolean(checked), simulated: Boolean(simulated), read: Boolean(read), downloaded: Boolean(downloaded), stale: Boolean(source && view.response && !fresh), issue, overrides };
}


const copy = {
  home: ['Start', 'شروع'], mode: ['Workspace mode', 'حالت محیط'], student: ['Student', 'دانشجویی'], expert: ['Full workspace', 'محیط کامل'], language: ['Interface language', 'زبان راهنما'],
  eyebrow: ['YOUR MOLECULAR LAB', 'آزمایشگاه مولکولی تو'], title: ['A clear path from strands to results.', 'از رشته‌ها تا نتیجه، قدم به قدم.'], intro: ['Start a guided example, bring your own source, or continue a project. Calculations run on your computer.', 'با یک مثال آموزشی شروع کن، کد خودت را وارد کن یا پروژه‌ات را ادامه بده. محاسبات روی رایانهٔ تو انجام می‌شوند.'],
  lessonTitle: ['Start an exercise', 'شروع تمرین'], lessonText: ['Learn what to run and what the curves mean, with a short lesson beside your model.', 'کنار مدل، هدف تمرین، مسیر اجرا و معنای نمودارها را یاد بگیر.'], lessonAction: ['Choose a guided example', 'انتخاب مثال آموزشی'],
  importTitle: ['Bring your model', 'وارد کردن مدل'], importText: ['Open a DSD or CRN source file. Current and old Visual DSD syntax are supported.', 'فایل مدل را باز کن. سینتکس فعلی و قدیمی پشتیبانی می‌شوند.'], importAction: ['Open model file', 'باز کردن فایل مدل'],
  continueTitle: ['Continue your work', 'ادامهٔ پروژه'], continueText: ['Resume this browser workspace, or open a project file with its saved settings and results.', 'محیط فعلی مرورگر را ادامه بده یا فایل پروژه را همراه تنظیمات و نتایج ذخیره‌شده باز کن.'], resume: ['Resume workspace', 'ادامهٔ محیط فعلی'], openProject: ['Open project file', 'باز کردن فایل پروژه'], blank: ['Start a blank model', 'شروع مدل خالی'],
  local: ['No account. No SDK. Keep a project file for a portable copy of your work.', 'بدون حساب کاربری و ابزار توسعه. برای نگهداری و جابه‌جایی کار، فایل پروژه بگیر.'], storage: ['Browser storage is unavailable. Download your model or project before closing this page.', 'ذخیرهٔ مرورگر در دسترس نیست. پیش از بستن صفحه، مدل یا پروژه را دانلود کن.'],
  ready: ['Service ready', 'سرویس آماده است'], offline: ['Service unavailable · you can edit and save files; restart the app to run models.', 'سرویس در دسترس نیست؛ ویرایش و ذخیرهٔ فایل ممکن است. برای اجرا، برنامه را دوباره راه‌اندازی کن.'], loading: ['Connecting to the local service…', 'در حال اتصال به سرویس محلی…'],
  guided: ['GUIDED WORKSPACE', 'مسیر آموزشی'], sourceStep: ['Source', 'کد مدل'], checkStep: ['Check', 'بررسی'], runStep: ['Simulate', 'شبیه‌سازی'], readStep: ['Review', 'مشاهده'], saveStep: ['Download', 'دانلود'],
  sourceTitle: ['Add a model to begin.', 'ابتدا مدل را وارد کن.'], sourceHelp: ['Type or paste source below, open a model file, or choose a lesson from Start.', 'کد را در ویرایشگر بنویس یا بچسبان، فایل مدل باز کن یا از صفحهٔ شروع یک مثال انتخاب کن.'], sourceAction: ['Go to source', 'رفتن به کد'],
  checkTitle: ['Check your model before running.', 'مدل را پیش از اجرا بررسی کن.'], checkHelp: ['Check validates the source. It does not simulate the model or prove the circuit is correct.', 'بررسی، درستی نگارش کد را می‌سنجد؛ مدل را شبیه‌سازی نمی‌کند و درستی مدار را اثبات نمی‌کند.'], checkAction: ['Check model', 'بررسی مدل'],
  simulateTitle: ['Your source is checked. Run the model.', 'کد بررسی شد؛ حالا مدل را اجرا کن.'], simulateHelp: ['Simulation calculates how the plotted concentrations change over the source-defined time interval.', 'شبیه‌سازی، تغییر غلظت‌های انتخاب‌شده را در بازهٔ زمانی مدل محاسبه می‌کند.'], simulateAction: ['Simulate', 'شبیه‌سازی'],
  readTitle: ['The simulation is ready to explore.', 'نتیجهٔ شبیه‌سازی آمادهٔ مشاهده است.'], readHelp: ['Open the curves. Read the time and concentration units; compare the legend with the species in Network. A curve alone does not establish a logical output.', 'نمودار را باز کن، واحد زمان و غلظت را بخوان و نام سیگنال‌ها را با شبکه مقایسه کن. نمودار به‌تنهایی خروجی منطقی را تعیین نمی‌کند.'], readAction: ['Review simulation', 'مشاهدهٔ نتیجه'],
  saveTitle: ['Keep this experiment as a project.', 'این آزمایش را به‌صورت پروژه نگه دار.'], saveHelp: ['Download a project containing the source, settings and completed results. Browser drafts alone do not preserve results after reload.', 'فایل پروژه شامل کد، تنظیمات و نتایج کامل است. پیش‌نویس مرورگر به‌تنهایی نتیجه را پس از بارگذاری دوباره نگه نمی‌دارد.'], saveAction: ['Download project', 'دانلود پروژه'],
  doneTitle: ['Project download requested.', 'دانلود پروژه درخواست شد.'], doneHelp: ['Check your browser downloads and keep the project file. Try one change in the source, then check and simulate again.', 'فایل را در دانلودهای مرورگر بررسی و نگهداری کن. حالا یک تغییر کوچک بده و دوباره بررسی و شبیه‌سازی کن.'], doneAction: ['View results again', 'مشاهدهٔ دوبارهٔ نتیجه'],
  busyTitle: ['Calculation in progress.', 'محاسبه در حال اجراست.'], busyHelp: ['The guide advances only after the calculation completes. Stop explicitly cancels the current calculation.', 'پس از کامل شدن محاسبه، مرحلهٔ بعد باز می‌شود. توقف، محاسبهٔ فعلی را لغو می‌کند.'], stop: ['Stop calculation', 'توقف محاسبه'],
  stale: ['Source or settings changed. Check and run again to update the results.', 'کد یا تنظیمات تغییر کرده است. برای نتیجهٔ تازه، دوباره بررسی و اجرا کن.'], issue: ['The model needs attention. Read the diagnostic below and correct the source before trying again.', 'مدل نیاز به اصلاح دارد. پیام خطای زیر را بخوان، کد را اصلاح کن و دوباره تلاش کن.'],
  tools: ['Open full workspace', 'باز کردن محیط کامل'], toolsHelp: ['Full tools include inference, state exploration, synthesis and scientific exports. Switching mode preserves your source and settings.', 'محیط کامل، برازش، فضای حالت، سنتز و خروجی‌های علمی را دارد. تغییر حالت، کد و تنظیمات را حفظ می‌کند.'], overrides: ['Custom settings are active. Open full workspace to review all overrides.', 'تنظیمات سفارشی فعال است. برای دیدن همهٔ تنظیمات، محیط کامل را باز کن.'], network: ['Explore the network', 'مشاهدهٔ شبکه'], guide: ['Read the example guide', 'خواندن راهنمای مثال'],
};

export class StudentWorkspace {
  constructor({ language, setLanguage, action }) {
    this.language = language; this.setLanguage = setLanguage; this.action = action;
    this.preferences = readStudentPreferences(); this.latest = {}; this.available = null;
    const byId = id => document.getElementById(id); this.byId = byId;
    for (const [id, event] of [['workspace-home', 'home'], ['home-lesson', 'lesson'], ['home-model', 'model'], ['home-project', 'project'], ['home-resume', 'resume'], ['home-blank', 'blank'], ['student-full', 'expert'], ['student-network', 'network'], ['student-guide', 'guide']]) byId(id).addEventListener('click', () => this.dispatch(event));
    byId('workspace-mode').addEventListener('change', event => { this.preferences.mode = event.target.value === 'expert' ? 'expert' : 'student'; this.show('workspace'); });
    byId('workspace-language').addEventListener('change', event => setLanguage(event.target.value));
    byId('student-next').addEventListener('click', () => this.action(studentJourney(this.latest.model, this.latest.view).stage));
    byId('student-stop').addEventListener('click', () => this.action('stop'));
    this.render();
  }
  t(key) { return copy[key][this.language() === 'fa' ? 1 : 0]; }
  show(screen, focus = true) {
    this.preferences.screen = screen === 'home' ? 'home' : 'workspace'; writeStudentPreferences(this.preferences); this.render();
    if (focus) this.byId(this.preferences.screen === 'home' ? 'home-title' : this.preferences.mode === 'student' ? 'student-title' : 'model-name').focus();
  }
  dispatch(action) {
    if (action === 'home') return this.show('home');
    if (action === 'resume') return this.show('workspace');
    if (action === 'expert') { this.preferences.mode = 'expert'; return this.show('workspace'); }
    this.action(action);
  }
  update(latest) { this.latest = latest; this.render(); }
  render() {
    const { model, view, busy, canPersist = true, version } = this.latest, journey = studentJourney(model, view);
    const fa = this.language() === 'fa', home = this.preferences.screen === 'home';
    document.body.dataset.workspaceMode = this.preferences.mode;
    this.byId('student-home').hidden = !home; this.byId('workspace-container').hidden = home;
    this.byId('workspace-home').setAttribute('aria-current', home ? 'page' : 'false');
    this.byId('workspace-mode').value = this.preferences.mode; this.byId('workspace-language').value = this.language();
    for (const element of document.querySelectorAll('[data-student-copy]')) element.textContent = this.t(element.dataset.studentCopy);
    for (const element of document.querySelectorAll('.student-localized')) { element.dir = fa ? 'rtl' : 'ltr'; element.lang = fa ? 'fa' : 'en'; }
    this.byId('workspace-mode').setAttribute('aria-label', this.t('mode')); this.byId('workspace-language').setAttribute('aria-label', this.t('language'));
    this.byId('home-resume').disabled = !model;
    this.byId('home-current').textContent = model?.name || '';
    this.byId('home-lesson').disabled = this.available !== true;
    this.byId('home-project').disabled = Boolean(busy);
    this.byId('home-connection').textContent = this.t(this.available === null ? 'loading' : this.available ? 'ready' : 'offline');
    this.byId('home-version').textContent = version ? `Visual DSD Rebooted ${version}` : '';
    this.byId('home-storage').hidden = canPersist;
    this.byId('student-title').textContent = this.t(busy ? 'busyTitle' : `${journey.stage}Title`);
    this.byId('student-help').textContent = this.t(busy ? 'busyHelp' : `${journey.stage}Help`);
    this.byId('student-next').textContent = this.t(`${journey.stage}Action`); this.byId('student-next').disabled = Boolean(busy) || !model || (['check', 'simulate'].includes(journey.stage) && this.available !== true);
    this.byId('student-stop').hidden = !busy; this.byId('student-stop').disabled = !busy?.id || Boolean(busy?.cancelling);
    this.byId('student-warning').textContent = journey.issue ? this.t('issue') : journey.stale ? this.t('stale') : journey.overrides ? this.t('overrides') : '';
    this.byId('student-warning').hidden = !this.byId('student-warning').textContent;
    this.byId('student-network').hidden = !view?.response?.success;
    this.byId('student-guide').hidden = !model?.exampleId;
    const stages = ['source', 'check', 'simulate', 'read', 'save'], active = journey.stage === 'done' ? 5 : stages.indexOf(journey.stage);
    for (const [index, element] of [...this.byId('student-steps').children].entries()) {
      element.classList.toggle('complete', index < active); element.classList.toggle('current', index === active);
      if (index === active) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
    }
  }
}
