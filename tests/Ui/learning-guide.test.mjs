import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from '../../src/VisualDsd.App/Web/model.js';
import { lessons, lessonOrder, glossary, operations, lessonFor, filterTeachingExamples, lessonMatchesDocument } from '../../src/VisualDsd.App/Web/learning-guide.js';

const assets = readFileSync(new URL('../../src/VisualDsd.App/WebAssets.cs', import.meta.url), 'utf8');
const workspace = assets.split('private static readonly ExampleInfo[] WorkspaceExamples')[1].split('public static readonly ExampleInfo[] Examples')[0];
const catalog = [...workspace.matchAll(/new\("([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)"(?:, "([^"]+)")?/g)].map(([, id, name, description, dialect, language]) => ({ id, name, description, dialect, language: language || 'dsd', category: 'Workspace' }));

test('every bundled teaching example has a distinct bilingual lesson, actual run action, results tab and defined glossary terms', () => {
  assert.equal(catalog.length, 17); assert.deepEqual(new Set(lessonOrder), new Set(catalog.map(e => e.id))); assert.equal(lessonOrder.length, 17);
  const html = readFileSync(new URL('../../src/VisualDsd.App/Web/index.html', import.meta.url), 'utf8');
  for (const example of catalog) {
    const lesson = lessonFor(example); assert.equal(lesson, lessons[example.id]);
    for (const field of ['topic', 'goal', 'expect', 'experiment']) for (const language of ['fa', 'en']) assert.ok(lesson[field][language].length > 10, `${example.id}: ${field}/${language}`);
    assert.ok(Object.hasOwn(operations, lesson.operation)); assert.ok(html.includes(`>${lesson.tab}</button>`) || lesson.tab === 'Species');
    assert.ok(lesson.terms.length >= 2); for (const term of lesson.terms) assert.ok(glossary[term]?.fa && glossary[term]?.en, `${example.id}: ${term}`);
  }
  assert.match(lessons['inference-linked'].goal.en, /synthetic/);
  assert.match(lessons['synthesis-turing'].expect.en, /not a final spatial pattern/);
  assert.match(lessons['moment-closure'].goal.en, /approximation/);
});

test('educational purpose is searchable in Persian and English without dropping category or all-word matching', () => {
  assert.ok(filterTeachingExamples(catalog, 'نوسان').some(e => e.id === 'lna-covariance'));
  assert.ok(filterTeachingExamples(catalog, 'برازش').some(e => e.id === 'inference-linked'));
  assert.deepEqual(filterTeachingExamples(catalog, 'bistable EQUILIBRIA').map(e => e.id), ['synthesis-bistable']);
  assert.deepEqual(filterTeachingExamples(catalog, 'دوپایداری').map(e => e.id), ['synthesis-bistable']);
  assert.equal(filterTeachingExamples(catalog, '', 'missing').length, 0);
  const before = catalog.map(e => e.id); filterTeachingExamples(catalog, 'state'); assert.deepEqual(catalog.map(e => e.id), before);
});

test('all original catalog examples receive an explicitly general reading guide without invented research outcomes', () => {
  const originals = JSON.parse(readFileSync(new URL('../../src/VisualDsd.App/OriginalExamples.json', import.meta.url), 'utf8'));
  assert.ok(originals.length > 100);
  for (const example of originals) { const lesson = lessonFor(example); assert.equal(lesson.level, 'original'); assert.equal(lesson.operation, 'parse'); assert.match(lesson.experiment.en, /general reading guide/); }
  assert.equal(lessonFor({ id: 'constructor' }).level, 'original');
  assert.equal(lessonFor({ id: '__proto__' }).level, 'original');
});

test('an unchanged teaching document can be reused after CRLF normalization; user edits and option overrides require a new copy', () => {
  const example = { id: 'crn-systems', code: '| 10 A\r\n| A ->{0.25} B\r\n', dialect: 'current', language: 'crn' };
  const doc = createDocument('example.crn', example.code, 'auto', example.id);
  assert.equal(lessonMatchesDocument(doc, example), true);
  doc.name = 'My renamed example.crn'; assert.equal(lessonMatchesDocument(doc, example), true);
  const changed = structuredClone(doc); changed.code += '// My edit\n'; assert.equal(lessonMatchesDocument(changed, example), false);
  changed.code = doc.code; changed.options.points = '25'; assert.equal(lessonMatchesDocument(changed, example), false);
  changed.options.points = ''; changed.exampleId = 'other'; assert.equal(lessonMatchesDocument(changed, example), false);
  changed.exampleId = example.id; changed.databases.toeholds = { name: 'custom', code: 'AAA' }; assert.equal(lessonMatchesDocument(changed, example), false);
});

test('teaching copies preserve supplied observation tables and never silently reuse edited fitting data', () => {
  const data = [{ name: 'low', tables: [{ times: [0, 1], series: [{ name: 'A', values: [10, 7] }] }] }];
  const example = { id: 'inference-linked', code: '| 10 A', dialect: 'current', language: 'crn', data };
  const doc = createDocument('fit.crn', example.code, 'auto', example.id); doc.data = structuredClone(data);
  assert.equal(lessonMatchesDocument(doc, example), true);
  doc.data[0].tables[0].series[0].values[1] = 6; assert.equal(lessonMatchesDocument(doc, example), false);
  doc.data = []; assert.equal(lessonMatchesDocument(doc, example), false);
  const legacy = { id: 'legacy-and', code: 'old source', dialect: 'legacy', language: 'dsd' };
  assert.equal(lessonMatchesDocument(createDocument('old.vdsd', legacy.code, 'legacy', legacy.id), legacy), true);
});
