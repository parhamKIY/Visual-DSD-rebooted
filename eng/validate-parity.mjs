import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDocument } from '../src/VisualDsd.App/Web/model.js';
import { readResponse, serialiseProject, parseProject } from '../src/VisualDsd.App/Web/project.js';

globalThis.crypto ??= webcrypto;
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = input => createHash('sha256').update(input).digest('hex');
const cases = (await Promise.all(['engine-baselines', 'compatibility-baselines'].map(async name =>
  JSON.parse(await readFile(resolve(root, 'tests/baselines', `${name}.json`), 'utf8')).cases))).flat();
assert.equal(cases.length, 300);
let successful = 0, unsupported = 0, trajectories = 0;
for (const item of cases) {
  const id = item.spec.id;
  try {
    const evidence = JSON.parse(await readFile(resolve(root, 'artifacts/public-parity', `${hash(id).toUpperCase()}.json`), 'utf8'));
    assert.equal(evidence.id, id);
    assert.equal(evidence.sourceSha256, item.sourceSha256);
    assert.equal(hash(await readFile(resolve(root, item.spec.source))), item.sourceSha256);
    assert.equal(evidence.results.length, item.expected.times.length ? 2 : 1);
    for (const { request, response } of evidence.results) {
      assert.equal(response.success, item.expected.status === 'pass');
      if (!response.success) {
        assert.equal(response.model, null); assert.ok(response.diagnostics.length);
        assert.throws(() => readResponse(response)); unsupported++; continue;
      }
      const parsed = readResponse(response);
      const document = createDocument('Reference.dsd', request.code, request.dialect);
      const view = { response: parsed, snapshot: { name: document.name, request, engineVersion: evidence.engineVersion }, runIndex: 0, tab: request.operation === 'simulate' ? 'plot' : 'species' };
      const project = serialiseProject([document], document.id, new Map([[document.id, view]]), evidence.engineVersion);
      const restored = parseProject(project).views.get(document.id);
      assert.deepEqual(restored.response, parsed);
      assert.equal(restored.snapshot.request.code, request.code);
      if (request.operation === 'simulate') trajectories++; else successful++;
      if (response.model.reactions.length) {
        const corrupt = structuredClone(response);
        corrupt.model.reactions[0].reactants.push({ speciesId: '__not_a_species__', multiplicity: 1 });
        assert.throws(() => readResponse(corrupt));
      }
    }
  } catch (error) { throw new Error(`Public/project compatibility failed for ${id}: ${error.message}`, { cause: error }); }
}
assert.equal(successful, 287); assert.equal(unsupported, 13); assert.equal(trajectories, 20);
console.log(`Verified public JSON and project roundtrips: ${successful} networks, ${trajectories} trajectories, ${unsupported} original unsupported outcomes.`);
