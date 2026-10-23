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
