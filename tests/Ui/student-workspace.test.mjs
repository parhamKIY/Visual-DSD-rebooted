import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor } from '../../src/VisualDsd.App/Web/model.js';
import { STUDENT_KEY, readStudentPreferences, writeStudentPreferences, studentJourney } from '../../src/VisualDsd.App/Web/student-workspace.js';
globalThis.crypto ??= webcrypto;

test('student navigation defaults safely and storage failures cannot prevent editing', () => {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  assert.deepEqual(readStudentPreferences(storage), { mode: 'student', screen: 'home' });
  assert.equal(writeStudentPreferences({ mode: 'expert', screen: 'workspace', code: 'never stored here' }, storage), true);
  assert.deepEqual(JSON.parse(memory.get(STUDENT_KEY)), { mode: 'expert', screen: 'workspace' });
  assert.deepEqual(readStudentPreferences(storage), { mode: 'expert', screen: 'workspace' });
  memory.set(STUDENT_KEY, '{broken'); assert.equal(readStudentPreferences(storage).screen, 'home');
  memory.set(STUDENT_KEY, JSON.stringify({ mode: '__proto__', screen: '<script>' })); assert.equal(readStudentPreferences(storage).mode, 'student');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readStudentPreferences(blocked).mode, 'student'); assert.equal(writeStudentPreferences({}, blocked), false);
});

test('the guided journey requires actual current results and an explicit review and project download', () => {
  const model = createDocument('model.dsd', '<a^ b>');
  const view = {};
  assert.equal(studentJourney(model, view).stage, 'check');
  model.code = ''; assert.equal(studentJourney(model, view).stage, 'source'); model.code = '<a^ b>';
  view.snapshot = { request: requestFor(model, 'parse') };
  view.response = { success: true, operation: 'parse', model: { simulations: [] } };
  assert.equal(studentJourney(model, view).stage, 'simulate');
  view.response = { success: true, operation: 'simulate', model: { simulations: [{ times: [0, 1] }] } };
  assert.equal(studentJourney(model, view).stage, 'read');
  view.studentReadResponse = view.response; assert.equal(studentJourney(model, view).stage, 'save');
  view.studentSavedResponse = view.response; assert.equal(studentJourney(model, view).stage, 'done');
  model.code += '\n// edited'; assert.equal(studentJourney(model, view).stage, 'check'); assert.equal(studentJourney(model, view).stale, true);
});

test('settings, databases, diagnostics, solver previews and replacement results invalidate completion', () => {
  const model = createDocument('model.dsd', '<a^ b>');
  const view = { snapshot: { request: requestFor(model, 'simulate') }, response: { success: true, operation: 'simulate', model: { simulations: [{ times: [0, 1] }] } } };
  view.studentReadResponse = view.response; view.studentSavedResponse = view.response;
  model.options.final = '2'; assert.equal(studentJourney(model, view).stage, 'check'); assert.equal(studentJourney(model, view).overrides, 1); model.options.final = '';
  model.databases.toeholds = { name: 'custom', code: 'AAAAAA' }; assert.equal(studentJourney(model, view).stage, 'check'); model.databases = {};
  view.diagnostics = [{ message: 'New calculation failed' }]; assert.equal(studentJourney(model, view).stage, 'check'); view.diagnostics = [];
  view.response = structuredClone(view.response); assert.equal(studentJourney(model, view).stage, 'read');
  view.response.model.simulations = []; view.live = { preview: { times: [0, 1] } }; assert.equal(studentJourney(model, view).stage, 'simulate');
  assert.deepEqual(model.options.final, '');
});
