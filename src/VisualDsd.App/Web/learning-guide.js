import { optionDefaults } from './model.js';
import { readDatasets } from './observations.js';

const pair = (fa, en) => ({ fa, en });
export const lessonOrder = ['catalytic', 'join', 'and-gate', 'transducer', 'legacy-and', 'crn-systems', 'state-switch', 'cme-distribution', 'lna-covariance', 'moment-closure', 'jit-states', 'jit', 'diffusion', 'crn-graph', 'inference-linked', 'synthesis-bistable', 'synthesis-turing'];
export const lessons = {
  catalytic: {
    level: 'start', operation: 'simulate', tab: 'Simulation', terms: ['DSD', 'Species', 'Reaction'],
    topic: pair('از رشتهٔ DNA تا نمودار غلظت', 'From DNA strands to concentration curves'),
    goal: pair('یاد می‌گیری چگونه کدِ رشته‌ها به واکنش و سپس به تغییر غلظت در طول زمان تبدیل می‌شود. از این مثال شروع کن.', 'Learn how strand code becomes reactions and then concentrations over time. Start here.'),
    expect: pair('در `Simulation` منحنی غلظت‌ها را ببین. سپس `Expand network` را بزن و در `Network` دنبال اتصال گونه‌ها بگرد؛ هر کادر یک گونهٔ مولکولی است.', 'Inspect concentration curves in `Simulation`. Then use `Expand network` and `Network` to connect those curves to molecular species and reactions.'),
    experiment: pair('مقدار اولیهٔ `13 * <2 3^ 4>` را به `26` تغییر بده و دوباره `Simulate` را بزن. شکل و مقدار منحنی‌ها را مقایسه کن.', 'Change the initial `13 * <2 3^ 4>` to `26` and press `Simulate` again. Compare the curves and concentrations.')
  },
  join: {
    level: 'start', operation: 'simulate', tab: 'Simulation', terms: ['DSD', 'Species'],
    topic: pair('دو ورودی، یک خروجی', 'Two inputs, one output'),
    goal: pair('می‌بینی یک دروازهٔ رشته‌ای چگونه دو ورودی را به آزاد شدن خروجی و فعال شدن گزارشگر وصل می‌کند.', 'See how a strand-displacement join gate connects two inputs to an output and a reporter signal.'),
    expect: pair('منحنی‌های `Input1`، `Input2`، `Output` و `Signal` را مقایسه کن؛ نام این‌ها در ابتدای کد تعریف شده است.', 'Compare the `Input1`, `Input2`, `Output` and `Signal` curves. Their names are defined near the top of the source.'),
    experiment: pair('مقدار اولیهٔ `Input2()` را از `10` به `0` تغییر بده و اثر نبودن ورودی دوم را ببین.', 'Change the initial `Input2()` from `10` to `0` and inspect the effect of removing the second input.')
  },
  'and-gate': {
    level: 'start', operation: 'simulate', tab: 'Simulation', terms: ['DSD', 'Species'],
    topic: pair('منطق AND با مولکول‌ها', 'An AND circuit made of molecules'),
    goal: pair('رفتار یک مدار مولکولی با دو ورودی را یاد می‌گیری: مقدار ورودی‌ها روی آزاد شدن خروجی اثر می‌گذارد.', 'Explore how two input populations control output release in a molecular AND circuit.'),
    expect: pair('منحنی خروجی را کنار ورودی‌ها ببین. برای پیدا کردن نام گونه‌ها از `Species` و تعریف‌های ابتدای کد کمک بگیر.', 'Inspect the output alongside the inputs. Use `Species` and the source definitions to identify the molecular names.'),
    experiment: pair('یکی از جمعیت‌های ورودی را صفر کن، دوباره اجرا کن و آن را با حالت هر دو ورودی مقایسه کن.', 'Set one initial input population to zero, run again and compare with the two-input case.')
  },
  transducer: {
    level: 'start', operation: 'simulate', tab: 'Simulation', terms: ['DSD', 'Reaction'],
    topic: pair('انتقال یک سیگنال رشته‌ای', 'Passing a strand signal onward'),
    goal: pair('می‌بینی چگونه ورود یک رشته می‌تواند رشتهٔ دیگری را آزاد کند و سیگنال را به مرحلهٔ بعد ببرد.', 'See how an incoming strand can release another strand and transmit a signal to the next stage.'),
    expect: pair('در نمودار، تغییر ورودی و خروجی را دنبال کن؛ در `Network` مسیر واکنش بین ساختارهای مولکولی را ببین.', 'Follow the input and output curves, then inspect their molecular reaction path in `Network`.'),
    experiment: pair('جمعیت اولیهٔ ورودی را تغییر بده و ببین مقدار و زمان ظاهر شدن خروجی چطور عوض می‌شود.', 'Change the initial input population and observe the amount and timing of output release.')
  },
  'legacy-and': {
    level: 'start', operation: 'expand', tab: 'Network', terms: ['DSD', 'Reaction'],
    topic: pair('خواندن سینتکس قدیمی', 'Reading the original syntax'),
    goal: pair('با شیوهٔ قدیمی نوشتن مدل آشنا می‌شوی و می‌بینی که می‌توان آن را به گونه‌ها و واکنش‌های قابل بررسی تبدیل کرد.', 'Recognize the original Visual DSD syntax and expand it into inspectable species and reactions.'),
    expect: pair('نشانگر `Old syntax` و سپس گونه‌ها و واکنش‌های شبکه را ببین. `Check` فقط کد را بررسی می‌کند؛ رسم شبکه با `Expand network` انجام می‌شود.', 'Inspect the `Old syntax` badge and the expanded species and reactions. `Check` parses the model; `Expand network` generates the reaction network.'),
    experiment: pair('یکی از مقدارهای اولیه را تغییر بده، دوباره شبکه را بساز و بعد با `Simulate` اثر تغییر را بررسی کن.', 'Change an initial population, expand again, then use `Simulate` to inspect its effect.')
  },
  'crn-systems': {
    level: 'start', operation: 'simulate', tab: 'Simulation', terms: ['CRN', 'Species', 'Reaction'],
    topic: pair('خواندن معادله و مقایسهٔ دو سیستم', 'Read reactions and compare two systems'),
    goal: pair('به‌جای شکل رشته‌ها، واکنش `A ->{k} B` را مستقیم می‌نویسی: گونهٔ `A` با نرخ `k` به `B` تبدیل می‌شود.', 'Write `A ->{k} B` directly: species `A` converts to `B` with rate parameter `k`.'),
    setup: pair('ابتدا `Check` را بزن. از `System`، سیستم `slow` را انتخاب کن.', 'Press `Check`, then select the `slow` system in `System`.'),
    expect: pair('کاهش `A` و افزایش `B` را ببین. سپس سیستم `fast` را انتخاب و جداگانه شبیه‌سازی کن؛ نرخ و مقدار اولیهٔ آن متفاوت است.', 'Observe `A` decreasing and `B` increasing. Select and simulate `fast` separately; its rate and initial population differ.'),
    experiment: pair('نرخ `k` را در یکی از سیستم‌ها عوض کن. بررسی کن چرا منحنی‌های دو سیستم با هم فرق دارند.', 'Change `k` in one system and examine why the two sets of curves differ.')
  },
  'state-switch': {
    level: 'explore', operation: 'analyze', tab: 'States', terms: ['SSA', 'State'],
    topic: pair('حالت‌های ممکنِ یک سیستم کوچک', 'Possible states of a small system'),
    goal: pair('بین «گونهٔ مولکولی» و «حالت سیستم» فرق می‌گذاری: حالت می‌گوید از هر گونه چند مولکول داریم.', 'Distinguish a molecular species from a population state: a state records how many molecules of each species exist.'),
    expect: pair('با چهار مولکول و تبدیل برگشت‌پذیر `A` و `B`، پنج ترکیب جمعیتی قابل دسترسی است. گره‌های `States` را انتخاب کن و تعداد هر گونه را ببین.', 'Four molecules switching between `A` and `B` give five reachable population combinations. Select nodes in `States` to inspect their counts.'),
    experiment: pair('جمعیت اولیهٔ `<a>` را از `4` به `2` تغییر بده و دوباره `Explore states` را بزن؛ تعداد حالت‌ها را مقایسه کن.', 'Change the initial `<a>` population from `4` to `2`, run `Explore states` again and compare the state count.')
  },
  'cme-distribution': {
    level: 'explore', operation: 'simulate', tab: 'Probabilities', terms: ['CRN', 'CME', 'State'],
    topic: pair('احتمالِ هر تعداد مولکول', 'The probability of each molecule count'),
    goal: pair('یاد می‌گیری نتیجهٔ یک سیستم تصادفی را به شکل توزیع احتمال ببینی: در هر زمان، هر تعداد مولکول چه احتمالی دارد؟', 'Read a stochastic result as a probability distribution: how likely is each molecule count at a given time?'),
    expect: pair('در `Probabilities` گونه و زمان را تغییر بده. ابتدا همهٔ احتمال روی جمعیت اولیه است؛ با گذشت زمان، احتمال بین حالت‌های مختلف پخش می‌شود.', 'Change species and time in `Probabilities`. Probability starts at the initial population and spreads over possible states as the reaction proceeds.'),
    experiment: pair('مقدار اولیهٔ `A` را از `10` به `5` تغییر بده و گستره و شکل توزیع را مقایسه کن.', 'Change initial `A` from `10` to `5` and compare the distribution range and shape.')
  },
  'lna-covariance': {
    level: 'explore', operation: 'simulate', tab: 'Simulation', terms: ['CRN', 'LNA', 'Covariance'],
    topic: pair('میانگین، نوسان و هم‌بستگی', 'Means, fluctuations and covariance'),
    goal: pair('می‌بینی چرا عدم‌قطعیتِ جمع دو گونه به هم‌بستگی آن‌ها وابسته است. با مصرف شدن `A`، مقدار `B` زیاد می‌شود.', 'See why uncertainty in a sum depends on covariance: as `A` is consumed, `B` increases.'),
    expect: pair('منحنی‌های `A`، `B`، جمع و تفاضل آن‌ها را همراه عدم‌قطعیت مقایسه کن. در این واکنش، جمع `A+B` ثابت می‌ماند.', 'Compare `A`, `B`, their sum and their difference with uncertainty. The reaction conserves `A+B`.'),
    experiment: pair('در `directive stochastic`، مقدار `scale` را از `10` به `100` تغییر بده و اثر آن را روی نوسان نسبی بررسی کن.', 'Change `scale` from `10` to `100` in `directive stochastic` and inspect the relative fluctuations.')
  },
  'moment-closure': {
    level: 'explore', operation: 'simulate', tab: 'Simulation', terms: ['CRN', 'Moments'],
    topic: pair('خلاصه کردن رفتار تصادفی با میانگین و واریانس', 'Summarize stochastic behaviour with moments'),
    goal: pair('با روش محاسبهٔ میانگین و نوسان آشنا می‌شوی. معادلات مرتبهٔ اول و دوم در این مثال خطی دقیق‌اند؛ بستن ممان‌ها در مدل‌های غیرخطی معمولاً تقریب است.', 'Learn to compute means and fluctuations. First and second moment equations are exact for this linear example; closure in nonlinear models is generally an approximation.'),
    expect: pair('تغییر میانگین گونه‌های `A` و `B` و عدم‌قطعیت آن‌ها را ببین. تنظیم `order=2` در کد، ممان‌های مرتبهٔ دوم را نگه می‌دارد.', 'Inspect the means and uncertainty of `A` and `B`. The source setting `order=2` retains second-order moments.'),
    experiment: pair('نرخ `0.35` را به `0.7` تغییر بده و زمان تبدیل و روند نوسان را مقایسه کن.', 'Change the rate from `0.35` to `0.7` and compare conversion timing and fluctuations.')
  },
  'jit-states': {
    level: 'explore', operation: 'analyze', tab: 'States', terms: ['DSD', 'JIT', 'State'],
    topic: pair('کشف تدریجی حالت‌های اتصال', 'Discover binding states on demand'),
    goal: pair('حالت‌های جمعیتیِ قابل دسترسی را هم‌زمان با کشف اتصال‌ها بررسی می‌کنی؛ لازم نیست همهٔ واکنش‌ها از ابتدا ساخته شده باشند.', 'Explore reachable population states while binding reactions are discovered on demand rather than fully generated in advance.'),
    expect: pair('در `States` گره‌ها را انتخاب کن؛ هر گره یک ترکیب جمعیتی است و یال‌ها واکنش‌های ممکن بین آن‌ها را نشان می‌دهند.', 'Select nodes in `States`: each is a population combination, and edges are possible reactions between states.'),
    experiment: pair('تعداد یکی از دو رشته را از `2` به `1` تغییر بده و ببین چه حالت‌هایی دیگر قابل دسترسی نیستند.', 'Change one initial strand population from `2` to `1` and inspect which states are no longer reachable.')
  },
  jit: {
    level: 'explore', operation: 'simulate', tab: 'Simulation', terms: ['DSD', 'JIT', 'SSA'],
    topic: pair('ساخت واکنش‌ها هنگام شبیه‌سازی', 'Generate reactions during simulation'),
    goal: pair('شبکهٔ واکنش با نیاز شبیه‌سازی رشد می‌کند. این روش برای مدل‌هایی مفید است که ساخت کامل شبکهٔ آن‌ها دشوار است.', 'The reaction network grows as the simulation needs it, which is useful when full expansion is difficult.'),
    expect: pair('مسیر زمانیِ تصادفی و گونه‌ها و واکنش‌های کشف‌شده را ببین. این مثال را با `Simulate` اجرا کن؛ دستور `jit` در کد فعال است.', 'Inspect the stochastic trajectory and discovered species and reactions. Run this example with `Simulate`; its source enables `jit`.'),
    experiment: pair('زمان پایان را بیشتر کن و تعداد گونه‌ها و واکنش‌های کشف‌شده را مقایسه کن.', 'Increase the final simulation time and compare the discovered species and reaction counts.')
  },
  diffusion: {
    level: 'explore', operation: 'simulate', tab: 'Spatial', terms: ['DSD', 'Diffusion'],
    topic: pair('غلظت در مکان و زمان', 'Concentration across space and time'),
    goal: pair('به‌جای فرض مخلوط بودن کامل محیط، پخش شدن گونه‌ها روی یک صفحهٔ دوبعدی را می‌بینی.', 'Replace the well-mixed assumption with diffusion of species over a two-dimensional domain.'),
    expect: pair('در `Spatial` زمان و گونه را تغییر بده. تودهٔ اولیهٔ `a` پخش می‌شود و با واکنش به `b` تبدیل می‌شود.', 'Change time and species in `Spatial`. The initial `a` pulse spreads and reacts into `b`.'),
    experiment: pair('ضریب انتشار `<a>=0.02` را به `0.04` تغییر بده و سرعت پهن شدن توده را مقایسه کن.', 'Change the diffusion coefficient `<a>=0.02` to `0.04` and compare how quickly the pulse spreads.')
  },
  'crn-graph': {
    level: 'advanced', operation: 'simulate', tab: 'Models', terms: ['CRN', 'Inference'],
    topic: pair('مدل، سیستم و ارتباط بین مدل‌ها', 'Models, systems and their links'),
    goal: pair('ساختار یک پروژهٔ چندمدلی را می‌خوانی: هر مدل سیستم‌های خودش را دارد و ارتباط‌ها می‌توانند اطلاعات پارامترها را منتقل کنند.', 'Read a multi-model project: each model owns systems, and links can transfer fitted parameter information.'),
    setup: pair('ابتدا `Check` را بزن. برای شبیه‌سازی، `calibration` و سیستم `decay` را از `Model node` و `System` انتخاب کن.', 'Press `Check`. Select `calibration` and its `decay` system using `Model node` and `System`.'),
    expect: pair('در `Models` ارتباط‌ها و در `Simulation` نتیجهٔ سیستم انتخاب‌شده را ببین. مثال `Linked inference` دادهٔ لازم برای تمرین برازش را هم دارد.', 'Inspect links in `Models` and the selected system in `Simulation`. `Linked inference` also supplies data for practising parameter fitting.'),
    experiment: pair('مدل `prediction` و سیستم `reversible` را انتخاب کن و نتیجهٔ آن را جداگانه شبیه‌سازی کن.', 'Select `prediction` and `reversible` and simulate that system separately.')
  },
  'inference-linked': {
    level: 'advanced', operation: 'infer', tab: 'Fit', terms: ['CRN', 'Inference', 'MCMC'],
    topic: pair('یاد گرفتن نرخ‌ها از داده', 'Learn reaction rates from data'),
    goal: pair('نرخ‌ها را از دادهٔ مشاهده‌شده تخمین می‌زنی و اطلاعات برازش را بین دو مدل منتقل می‌کنی. داده‌های این مثال آموزشی و ساختگی‌اند و همراه مثال باز می‌شوند.', 'Estimate rates from observations and transfer fitted information between two models. This example includes synthetic teaching data.'),
    expect: pair('در `Fit` پارامترهای `k` و `h`، زنجیره‌ها و توزیع برآوردها را ببین. در `Simulation` منحنی‌های برازش‌شده و نقطه‌های داده را مقایسه کن.', 'Inspect `k`, `h`, chains and posterior distributions in `Fit`. Compare fitted curves and observation points in `Simulation`.'),
    experiment: pair('تعداد `samples` را تغییر بده و نرمی توزیع برآوردها را مقایسه کن؛ یک اجرای کوتاه به‌تنهایی همگرایی را ثابت نمی‌کند.', 'Change `samples` and compare the posterior distributions; a short run alone does not establish convergence.')
  },
  'synthesis-bistable': {
    level: 'advanced', operation: 'synthesize', tab: 'Synthesis', terms: ['CRN', 'Synthesis', 'Equilibrium'],
    topic: pair('پیدا کردن دو حالت پایدار', 'Find two stable equilibria'),
    goal: pair('یاد می‌گیری به‌جای فقط شبیه‌سازی یک مسیر، شرایط داشتن دو حالت پایدار را بررسی کنی؛ مانند سیستمی که می‌تواند در دو وضعیت متفاوت باقی بماند.', 'Go beyond one simulated trajectory and check for two stable equilibria: a system that can settle in either of two states.'),
    expect: pair('در `Synthesis` تعادل‌های پایدار `(1,1)` و `(3,3)` و مسیرهای فاز را ببین. کادرهای نتیجه دو تعادل پایدار را نشان می‌دهند؛ نقطهٔ میانی `(2,2)` در معادلات این مثال ناپایدار است.', 'Inspect stable equilibria `(1,1)` and `(3,3)` and phase trajectories in `Synthesis`. The result cards show two stable equilibria; the source equations also have an unstable intermediate equilibrium `(2,2)`.'),
    experiment: pair('مقدار اولیهٔ هر دو گونه را تغییر بده و با `Simulate` بررسی کن مسیر به کدام تعادل نزدیک می‌شود.', 'Change both initial populations and use `Simulate` to examine which equilibrium the trajectory approaches.')
  },
  'synthesis-turing': {
    level: 'advanced', operation: 'synthesize', tab: 'Synthesis', terms: ['CRN', 'Synthesis', 'Diffusion'],
    topic: pair('چه زمانی واکنش و انتشار می‌توانند الگو بسازند؟', 'When can reaction and diffusion generate patterns?'),
    goal: pair('یک ضریب انتشار جست‌وجو می‌شود تا وضعیت یکنواخت در برابر برخی تغییرات مکانی ناپایدار شود؛ این شرط آغاز تشکیل الگوی تورینگ است.', 'Search for a diffusion coefficient that destabilizes the homogeneous state against some spatial perturbations: the onset of a Turing pattern.'),
    expect: pair('مقدار پیشنهادی `DY` و منحنی رشد اغتشاش‌ها را در `Synthesis` ببین. رشد مثبت برای بعضی عددهای موج، شرط ناپایداری را نشان می‌دهد؛ این نمودار، تصویر نهایی الگوی مکانی نیست.', 'Inspect the proposed `DY` and dispersion curve in `Synthesis`. Positive growth at some wave numbers indicates instability; the curve is not a final spatial pattern.'),
    experiment: pair('بازهٔ جست‌وجوی `DY` را در تعریف پارامتر محدودتر کن و دوباره `Synthesize parameters` را بزن.', 'Narrow the search interval for `DY` in its parameter definition and run `Synthesize parameters` again.')
  }
};

export const glossary = {
  DSD: pair('جابجایی رشته‌های DNA؛ اتصال و جدا شدن رشته‌ها، واکنش‌های مدل را می‌سازد.', 'DNA strand displacement: strand binding and displacement generate model reactions.'),
  CRN: pair('شبکهٔ واکنش‌های شیمیایی؛ گونه‌ها و واکنش‌ها مستقیماً با معادله نوشته می‌شوند.', 'Chemical reaction network: species and reactions are written directly as equations.'),
  Species: pair('یک نوع مولکول یا ساختار مولکولی؛ مقدارش می‌تواند در طول زمان تغییر کند.', 'One molecular type or structure whose population or concentration may change over time.'),
  Reaction: pair('تبدیل گونه‌های ورودی به خروجی با یک قانون نرخ.', 'A conversion from reactant species to product species governed by a rate law.'),
  State: pair('وضعیت کل سیستم: تعداد مولکول‌های هر گونه در یک لحظه.', 'A population state: the molecule count of every species at one instant.'),
  SSA: pair('شبیه‌سازی تصادفی که رخدادهای واکنش را یکی‌یکی نمونه‌گیری می‌کند.', 'Stochastic simulation that samples individual reaction events.'),
  JIT: pair('تولید گونه‌ها و واکنش‌ها هنگام نیاز، به‌جای ساخت کامل شبکه در شروع.', 'Just-in-time generation of species and reactions when needed during execution.'),
  CME: pair('روشی برای محاسبهٔ احتمال حالت‌های جمعیتی مختلف در طول زمان.', 'Chemical master equation: evolves probabilities of population states over time.'),
  LNA: pair('تقریب نویز خطی؛ میانگین و نوسان اطراف رفتار میانگین را محاسبه می‌کند.', 'Linear noise approximation: computes means and fluctuations around mean behaviour.'),
  Covariance: pair('اندازهٔ تغییر مشترک دو گونه؛ می‌گوید افزایش یکی معمولاً با افزایش یا کاهش دیگری همراه است.', 'How two species vary together: an increase in one may accompany an increase or decrease in the other.'),
  Moments: pair('خلاصه‌های آماری مثل میانگین، واریانس و هم‌بستگی.', 'Statistical summaries such as means, variances and covariances.'),
  Diffusion: pair('پخش شدن مولکول‌ها در فضا؛ غلظت به مکان هم وابسته می‌شود.', 'Spatial spreading of molecules, making concentration depend on position.'),
  Inference: pair('تخمین مقدار پارامترهای مدل با استفاده از داده.', 'Estimating model parameters from observation data.'),
  MCMC: pair('نمونه‌گیری از توزیع برآورد پارامترها؛ رد زنجیره‌ها و همگرایی را هم باید بررسی کرد.', 'Sampling parameter posterior distributions; chain traces and convergence also need examination.'),
  Synthesis: pair('جست‌وجو یا بررسی شرایطی که مدل را دارای رفتار خواسته‌شده می‌کنند.', 'Search for or verify conditions under which a model has a desired behaviour.'),
  Equilibrium: pair('حالتی که نرخ تغییر غلظت‌ها صفر است؛ حالت پایدار پس از اغتشاش کوچک دوباره نزدیک می‌شود.', 'A state with zero concentration derivatives; a stable equilibrium attracts nearby trajectories.')
};

export const operations = { simulate: 'Simulate', expand: 'Expand network', analyze: 'Explore states', infer: 'Fit parameters', synthesize: 'Synthesize parameters', parse: 'Check' };
const searchAliases = { 'synthesis-bistable': 'دوپایداری bistability multistability', 'synthesis-turing': 'تورینگ pattern formation', 'inference-linked': 'استنباط fitting calibration', 'lna-covariance': 'کوواریانس noise fluctuations', 'cme-distribution': 'احتمالات distribution', 'jit-states': 'حالت اتصال binding' };
export function lessonFor(example) {
  if (Object.hasOwn(lessons, example.id)) return lessons[example.id];
  return { level: 'original', operation: 'parse', tab: 'Species', terms: [example.language === 'crn' ? 'CRN' : 'DSD', 'Species', 'Reaction'],
    topic: pair('خواندن و بررسی یک مدل از کتابخانهٔ اصلی', 'Read and inspect an original-library model'),
    goal: pair('این یک مدل پژوهشی از مجموعهٔ اصلی است. ابتدا تعریف گونه‌ها و ورودی‌ها را بخوان و کد را بررسی کن؛ سپس شبکه یا رفتار زمانی آن را مطالعه کن.', 'This is a research model from the original library. Read its species and inputs, check the source, then study its network or time course.'),
    expect: pair('پس از `Check`، گونه‌ها و تنظیمات مدل را ببین. برای شبکه `Expand network` و برای منحنی زمانی `Simulate` را بزن. مدل‌های دارای `jit` با `Simulate` اجرا می‌شوند. پیام‌های سینتکس یا محدودیت اجرا را همان‌جا بررسی کن.', 'After `Check`, inspect species and settings. Use `Expand network` for reactions or `Simulate` for a time course. Models with `jit` run with `Simulate`. Inspect any syntax or execution diagnostics.'),
    experiment: pair('یک مقدار اولیه یا نرخ را تغییر بده و نتیجه را با نسخهٔ نمونه مقایسه کن. این راهنمای عمومی است؛ هدف پژوهشی خاص مدل از عنوان، کد و منبع آن مشخص می‌شود.', 'Change one initial population or rate and compare with the original. This is a general reading guide; the specific research aim comes from the model title, source and code.') };
}
export function filterTeachingExamples(examples, query = '', category = '') {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return examples.filter(example => {
    if (category && example.category !== category) return false;
    const lesson = lessonFor(example), text = [example.name, example.description, example.source || '', example.category || 'Workspace', lesson.topic.fa, lesson.topic.en, lesson.goal.fa, lesson.goal.en, Object.hasOwn(searchAliases, example.id) ? searchAliases[example.id] : '', ...lesson.terms].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function lessonMatchesDocument(document, example) {
  const normalize = code => code.replace(/\r\n?/g, '\n');
  if (document.exampleId !== example.id || normalize(document.code) !== normalize(example.code)) return false;
  const expected = { ...optionDefaults, language: example.language || 'dsd', dialect: example.dialect === 'current' ? 'auto' : example.dialect };
  return Object.entries(expected).every(([key, value]) => document.options[key] === value) && !Object.keys(document.databases || {}).length && JSON.stringify(readDatasets(document.data)) === JSON.stringify(readDatasets(example.data || []));
}

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
function prose(tag, text, className = '') {
  const result = node(tag, className);
  for (const [i, part] of text.split(/`([^`]+)`/g).entries()) if (i % 2) { const code = node('code', '', part); code.dir = 'ltr'; result.append(code); } else result.append(document.createTextNode(part));
  return result;
}

export class LearningGuide {
  constructor(dialog, { examples, openExample, onLanguageChange }) {
    this.dialog = dialog; this.examples = examples; this.openExample = openExample; this.onLanguageChange = onLanguageChange;
    try { this.language = localStorage.getItem('visual-dsd.guide.language') === 'en' ? 'en' : 'fa'; } catch { this.language = 'fa'; }
    this.selected = 'catalytic'; this.query = '';
    this.parts = Object.fromEntries([...dialog.querySelectorAll('[data-guide]')].map(element => [element.dataset.guide, element]));
    this.parts.language.value = this.language;
    this.parts.language.addEventListener('change', () => {
      this.language = this.parts.language.value === 'en' ? 'en' : 'fa';
      try { localStorage.setItem('visual-dsd.guide.language', this.language); } catch { /* The guide also works without storage. */ }
      this.refresh(); this.onLanguageChange?.();
    });
    this.parts.search.addEventListener('input', () => { this.query = this.parts.search.value; this.parts.navigation.scrollTop = 0; this.renderNavigation(); });
    this.parts.close.addEventListener('click', () => dialog.close());
    this.parts.open.addEventListener('click', async () => {
      if (this.opening) return;
      const id = this.selected; this.opening = true; this.parts.open.disabled = true; this.parts.error.textContent = '';
      try { await this.openExample(id, { lesson: true }); dialog.close(); }
      catch (error) { this.parts.error.textContent = error.message; }
      finally { this.opening = false; this.parts.open.disabled = false; }
    });
    dialog.addEventListener('close', () => { if (this.returnFocus?.isConnected) this.returnFocus.focus(); else document.getElementById('open-learning-guide')?.focus(); });
  }
  t(fa, en) { return this.language === 'fa' ? fa : en; }
  open(id = 'catalytic') {
    this.selected = this.examples().some(example => example.id === id) ? id : 'catalytic'; this.query = ''; this.parts.search.value = '';
    this.returnFocus = document.activeElement; this.refresh(); if (!this.dialog.open) this.dialog.showModal();
    this.parts.navigation.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  refresh() {
    const fa = this.language === 'fa'; this.dialog.dir = fa ? 'rtl' : 'ltr'; this.dialog.lang = this.language;
    this.parts.heading.textContent = this.t('هر مثال چه چیزی یاد می‌دهد؟', 'What will each example teach me?');
    this.parts.intro.textContent = this.t('از مثال‌های پایه شروع کن. برای هر مثال، هدف، مسیر اجرا، نتیجهٔ قابل مشاهده و یک تمرین کوچک را بخوان.', 'Start with the foundations. Each lesson explains its purpose, what to click, what to look for and one small experiment.');
    this.parts.models.textContent = this.t('مدل‌های بازشده', 'Your open models');
    this.parts.modelsHelp.textContent = this.t('فهرست بالای ستون کناری، فایل‌های باز توست. کلیک روی نامشان فقط مدل فعال را عوض می‌کند.', 'The upper sidebar lists your open files. Clicking a name switches the active model.');
    this.parts.library.textContent = this.t('کتابخانهٔ مثال‌ها', 'The example library');
    this.parts.libraryHelp.textContent = this.t('فهرست پایین، نمونه‌های آماده است. نام هر مثال کدش را باز می‌کند؛ دکمهٔ راهنما هدف آن را توضیح می‌دهد.', 'The lower sidebar holds ready-made examples. An example name opens its source; its Guide button explains the lesson.');
    this.parts.path.textContent = this.t('مسیر پیشنهادی یادگیری', 'Suggested learning path');
    this.parts.searchLabel.textContent = this.t('پیدا کردن یک موضوع یا مثال', 'Find a topic or example');
    this.parts.search.placeholder = this.t('مثلاً: نوسان، برازش، CRN…', 'For example: fluctuations, inference, CRN…');
    this.parts.open.textContent = this.t('باز کردن نسخهٔ آموزشی', 'Open teaching copy');
    this.parts.copyNote.textContent = this.t('این راهنما مربوط به کد و تنظیمات نمونه است. دکمهٔ بالا نسخهٔ آموزشی را باز می‌کند و تغییرات مدل‌های بازشدهٔ تو را نگه می‌دارد.', 'These instructions refer to the supplied source and settings. The button opens a teaching copy while preserving edits in your open models.');
    this.parts.close.setAttribute('aria-label', this.t('بستن راهنمای مثال‌ها', 'Close example guide'));
    this.parts.error.textContent = ''; this.renderNavigation(); this.renderLesson();
  }
  renderNavigation() {
    const scroll = this.parts.navigation.scrollTop;
    const catalog = this.examples(), filtered = filterTeachingExamples(catalog, this.query);
    const rank = id => { const position = lessonOrder.indexOf(id); return position < 0 ? lessonOrder.length : position; };
    filtered.sort((a, b) => rank(a.id) - rank(b.id));
    const fragment = document.createDocumentFragment();
    this.parts.count.textContent = `${filtered.length} / ${catalog.length}`;
    if (!filtered.length) fragment.append(node('p', 'guide-empty', this.t('مثالی با این عبارت پیدا نشد؛ کلمهٔ کوتاه‌تری جست‌وجو کن.', 'No matching examples. Try a shorter search.')));
    for (const example of filtered) {
      const lesson = lessonFor(example), button = node('button', 'lesson-nav'); button.type = 'button';
      button.setAttribute('aria-current', String(example.id === this.selected)); button.dataset.example = example.id;
      const position = lessonOrder.indexOf(example.id), number = node('span', 'lesson-number', position < 0 ? '↗' : String(position + 1).padStart(2, '0')); number.setAttribute('aria-hidden', 'true');
      const content = node('span', 'lesson-nav-copy'), name = node('bdi', '', example.name); name.dir = 'ltr';
      content.append(name, prose('small', lesson.topic[this.language])); button.append(number, content);
      button.addEventListener('click', () => { this.selected = example.id; this.parts.error.textContent = ''; this.renderNavigation(); this.renderLesson(); this.parts.content.scrollTop = 0; });
      fragment.append(button);
    }
    this.parts.navigation.replaceChildren(fragment);
    this.parts.navigation.scrollTop = scroll;
  }
  renderLesson() {
    const example = this.examples().find(item => item.id === this.selected); if (!example) { this.parts.content.replaceChildren(node('p', '', this.t('کتابخانه هنوز بارگذاری نشده است.', 'The example library has not loaded yet.'))); this.parts.open.disabled = true; return; }
    this.parts.open.disabled = Boolean(this.opening);
    const lesson = lessonFor(example), text = value => value[this.language];
    const difficulty = { start: this.t('پایه · از اینجا شروع کن', 'Foundations · start here'), explore: this.t('کاوش · بعد از مثال‌های پایه', 'Explore · after the foundations'), advanced: this.t('پیشرفته · طراحی و برازش', 'Advanced · design and fitting'), original: this.t('کتابخانهٔ اصلی · راهنمای عمومی', 'Original library · general guide') };
    const hero = node('header', 'lesson-hero'); hero.append(node('span', `lesson-level ${lesson.level}`, difficulty[lesson.level]), prose('h3', text(lesson.topic)));
    const name = node('bdi', 'lesson-source-name', example.name); name.dir = 'ltr'; hero.append(name, prose('p', text(lesson.goal)));
    const steps = node('section', 'lesson-section'); steps.append(node('h4', '', this.t('قدم‌به‌قدم چه کار کنم؟', 'What do I do, step by step?')));
    const list = node('ol', 'lesson-steps');
    list.append(prose('li', this.t('«باز کردن نسخهٔ آموزشی» را بزن تا کد همین مثال در محیط اصلی باز شود.', 'Choose Open teaching copy to open this example in the workspace.')));
    if (lesson.setup) list.append(prose('li', text(lesson.setup)));
    list.append(prose('li', this.t(`دکمهٔ \`${operations[lesson.operation]}\` را بزن و منتظر پایان محاسبه بمان.`, `Press \`${operations[lesson.operation]}\` and wait for the calculation to finish.`)));
    list.append(prose('li', this.t(`در بخش نتایج، زبانهٔ \`${lesson.tab}\` را باز کن.`, `Open the \`${lesson.tab}\` results tab.`)));
    steps.append(list);
    const expected = node('section', 'lesson-section lesson-observe'); expected.append(node('h4', '', this.t('دنبال چه نتیجه‌ای بگردم؟', 'What should I look for?')), prose('p', text(lesson.expect)));
    const experiment = node('section', 'lesson-section lesson-experiment'); experiment.append(node('h4', '', this.t('حالا خودت یک تغییر کوچک بده', 'Try one small change')), prose('p', text(lesson.experiment)));
    const terms = node('section', 'lesson-section'); terms.append(node('h4', '', this.t('این اصطلاح‌ها یعنی چه؟', 'What do these terms mean?')));
    const definitions = node('dl', 'lesson-glossary');
    for (const term of lesson.terms) { const title = node('dt'); const code = node('code', '', term); code.dir = 'ltr'; title.append(code); definitions.append(title, prose('dd', text(glossary[term]))); }
    terms.append(definitions);
    const source = node('section', 'lesson-provenance'); source.append(node('strong', '', this.t('دربارهٔ این نمونه', 'About this example')), node('p', '', example.description));
    if (example.source) { const reference = node('bdi', '', example.source); reference.dir = 'ltr'; source.append(reference); }
    this.parts.content.replaceChildren(hero, steps, expected, experiment, terms, source);
  }
}
