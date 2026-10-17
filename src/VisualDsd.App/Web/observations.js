const fail = message => { throw new Error(`Invalid observation data: ${message}`); };
export function readObservations(raw) {
  if (!raw || !Array.isArray(raw.times) || raw.times.length < 2 || raw.times.length > 20000 || raw.times.some((value, index) => typeof value !== 'number' || !Number.isFinite(value) || index && value <= raw.times[index - 1])) fail('times must be finite and strictly increasing.');
  if (!Array.isArray(raw.series) || raw.series.length < 1 || raw.series.length > 64) fail('provide 1–64 columns.');
  const names = new Set();
  const series = raw.series.map(column => {
    if (!column || typeof column.name !== 'string' || !column.name.trim() || column.name.length > 512 || names.has(column.name) || column.standardDeviation != null || !Array.isArray(column.values) || column.values.length !== raw.times.length || column.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) fail('columns need unique names and one finite number per time.');
    names.add(column.name);
    return { name: column.name, values: [...column.values], ...(column.standardDeviation === null ? { standardDeviation: null } : {}) };
  });
  if (raw.timeUnit != null && (typeof raw.timeUnit !== 'string' || !raw.timeUnit.trim() || raw.timeUnit.length > 50)) fail('invalid time unit.');
  return { times: [...raw.times], series, ...(raw.timeUnit === undefined ? {} : { timeUnit: raw.timeUnit }) };
}

export function readDatasets(raw = []) {
  if (!Array.isArray(raw) || raw.length > 8) fail('provide at most eight datasets.');
  const names = new Set(); let count = 0;
  return raw.map(dataset => {
    if (!dataset || typeof dataset.name !== 'string' || !dataset.name.trim() || dataset.name.length > 120 || names.has(dataset.name) || !Array.isArray(dataset.tables) || !dataset.tables.length || dataset.tables.length > 32) fail('datasets need unique names and 1–32 tables.');
    names.add(dataset.name);
    const tables = dataset.tables.map(readObservations);
    count += tables.reduce((sum, table) => sum + table.times.length * table.series.length, 0);
    if (count > 20000) fail('at most 20000 measurements can be imported.');
    return { name: dataset.name, tables };
  });
}
