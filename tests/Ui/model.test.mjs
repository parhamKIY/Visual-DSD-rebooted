import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { MAX_CODE_BYTES, STORAGE_KEY, createDocument, restoreWorkspace, requestFor, highlightSource, positionAt, csvFor, reactionLabel, rateLabel } from '../../src/VisualDsd.App/Web/model.js';
globalThis.crypto ??= webcrypto;

test('source and settings round-trip without storing simulation results', () => {
  const document = createDocument('مدل.vdsd', '// original\r\n<a^ b>', 'legacy');
  document.options.seed = '42'; document.databases.toeholds = { name: 'rates.txt', code: 'a 0.1 0.2' };
  const restored = restoreWorkspace(JSON.stringify({ version: 1, documents: [document], activeId: document.id }));
  assert.equal(restored.documents[0].code, '// original\n<a^ b>');
  assert.equal(restored.documents[0].options.seed, '42');
  assert.equal(restored.documents[0].databases.toeholds.code, 'a 0.1 0.2');
  assert.equal(restored.activeId, document.id);
  assert.equal(STORAGE_KEY, 'visual-dsd.workspace.v1');
});

test('corrupt, oversized and duplicate browser drafts cannot break startup', () => {
  assert.equal(restoreWorkspace('{'), null);
  assert.equal(restoreWorkspace('{"version":2,"documents":[]}'), null);
  const valid = createDocument(), oversized = { ...createDocument(), code: 'a'.repeat(MAX_CODE_BYTES + 1) };
  const restored = restoreWorkspace(JSON.stringify({ version: 1, activeId: 'missing', documents: [null, oversized, valid, valid] }));
  assert.equal(restored.documents.length, 1);
  assert.equal(restored.activeId, valid.id);
  assert.throws(() => createDocument('x', 'ا'.repeat(MAX_CODE_BYTES)), /256 KiB/);
});

test('empty overrides preserve source-defined simulation behavior', () => {
  const document = createDocument('model.dsd', 'directive simulator deterministic\n<a>');
  const request = requestFor(document, 'simulate');
  assert.equal(request.simulator, 'source');
  assert.equal(request.timeoutSeconds, 30);
  for (const key of ['initial', 'final', 'points', 'seed', 'toeholds', 'specificities']) assert.equal(key in request, false);
  document.options.final = '1e3'; document.options.points = '250'; document.options.seed = '-42';
  document.databases.specificities = { name: 'custom', code: 'sequence data' };
  assert.equal(requestFor(document, 'simulate').final, 1000);
  assert.equal(requestFor(document, 'simulate').seed, -42);
  assert.equal(requestFor(document, 'parse').specificities, 'sequence data');
});

test('invalid overrides are rejected before admitting a calculation', () => {
  for (const [key, value] of [['points', '0'], ['points', '100001'], ['points', '1.5'], ['seed', '2147483648'], ['timeoutSeconds', '86401'], ['initial', 'Infinity'], ['final', 'x']]) {
    const document = createDocument(); document.options[key] = value;
    assert.throws(() => requestFor(document, 'simulate'), Error, `${key}=${value}`);
  }
  const document = createDocument(); document.options.initial = '10'; document.options.final = '5';
  assert.throws(() => requestFor(document, 'simulate'), /greater than/);
});

test('highlighting model text cannot create HTML or execute source comments', () => {
  const source = '// <img src=x onerror="alert(1)">\n<a^ b>\n/* </pre><script>bad()</script> */';
  const html = highlightSource(source);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script'), false);
  assert.ok(html.replace(/<[^>]*>/g, '').includes('&lt;a'));
  assert.ok(html.includes('token-comment'));
});

test('diagnostics select UTF-16 source positions and clamp invalid ranges', () => {
  const source = 'α\n🧬 x\n<bad';
  assert.equal(positionAt(source, 2, 4), 5);
  assert.equal(positionAt(source, 100, 100), source.length);
  assert.equal(positionAt(source, -1, -2), 0);
});

test('CSV exports every original sample at full precision with escaped headers', () => {
  const run = { times: [0, 0.123456789012345], series: [{ name: '<a>, "b"', values: [1e-12, -2.34567890123456] }, { name: '=test', values: [0, 5] }] };
  const csv = csvFor(run, 's');
  assert.equal(csv, 'Time (s),"<a>, ""b""",\'=test\r\n0,1e-12,0\r\n0.123456789012345,-2.34567890123456,5\r\n');
});

test('reaction labels preserve multiplicity, empty sides, catalysts and reverse rates', () => {
  const reaction = { reactants: [{ speciesId: 'a', multiplicity: 2 }], products: [], catalysts: [{ speciesId: 'c', multiplicity: 1 }], reverseRate: { expression: '2' } };
  assert.deepEqual(reactionLabel(reaction, [{ id: 'a', name: '<x>' }, { id: 'c', name: 'catalyst' }]), { equation: '2 <x> ⇌ ∅', catalysts: 'catalyst' });
});


test('reaction rates use exact decimal literals without rounding tiny or very large values', () => {
  for (const [source, expected] of [
    ['1.5E-05', '0.000015'], ['5e-5', '0.00005'], ['1E-17', '0.00000000000000001'],
    ['-1.25E+3', '-1250'], ['1.2345678901234567E-8', '0.000000012345678901234567'],
    ['.5e-2', '0.005'], ['0E+30', '0'], ['5E-324', '0.' + '0'.repeat(323) + '5'],
    ['1.7976931348623157E+308', '17976931348623157' + '0'.repeat(292)]
  ]) {
    assert.equal(rateLabel(source), expected);
    assert.equal(Number(rateLabel(source)), Number(source));
  }
});

test('rate formatting preserves algebra, symbolic keys, species and quoted names', () => {
  assert.equal(rateLabel('(0.0003 * 1.5E-05) + k1E-5 * [S1E-05]'), '(0.0003 * 0.000015) + k1E-5 * [S1E-05]');
  for (const value of ['k', 'normal * [A]', '10 * 10^(-17)', '1E-99999999', 'NaN', 'Infinity', '"1E-5"', "'1E-5'", 'κ1E-05', '0.000015']) assert.equal(rateLabel(value), value);
});
