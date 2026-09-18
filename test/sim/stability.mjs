// How stable is the current agent, honestly? Two different questions:
//   (a) how often does it do the right thing        -> pass rate
//   (b) does it do the SAME thing every time        -> consistency
// Both computed from the runs that used the final configuration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const files = fs.readdirSync(DIR);

// runs on the FINAL prompt+model: the last 3 reports per suite, plus the
// promptab "A" variant which used the identical prompt.
const reps = files.filter((f) => /^report_.*\.json$/.test(f)).sort();
const bySuite = { orig: [], new: [] };
for (const f of reps) {
  const j = read(f);
  if (!j.runs || j.runs.length < 60) continue;
  const isNew = Object.values(j.names).some((n) => /^[NOPQRSTU]\d\d /.test(n));
  bySuite[isNew ? 'new' : 'orig'].push(j);
}

const report = (label, runsList) => {
  const last = runsList.slice(-3);
  if (!last.length) return null;
  const maps = last.map((j) => {
    const m = {};
    for (const r of j.runs) m[(j.names[r.test_case_definition_id] || '?').slice(0, 3)] = r.status;
    return m;
  });
  const keys = [...new Set(maps.flatMap(Object.keys))];
  let always = 0, never = 0, flaky = 0;
  const neverList = [];
  for (const k of keys) {
    const p = maps.map((m) => m[k] === 'pass');
    if (p.every(Boolean)) always++;
    else if (p.every((x) => !x)) { never++; neverList.push(k); }
    else flaky++;
  }
  const scores = last.map((j) => j.job?.pass_count).filter((x) => x != null);
  return { label, runs: last.length, cases: keys.length, scores, always, never, flaky, neverList };
};

const rows = [report('suite 1 (original)', bySuite.orig), report('suite 2 (independent)', bySuite.new)].filter(Boolean);

console.log('MEASURED ON THE FINAL CONFIG (gpt-4.1, 25,888-char prompt)\n');
console.log('suite                  runs  cases   scores        always-pass  flaky  never-pass');
console.log('-'.repeat(84));
for (const r of rows) {
  console.log(`${r.label.padEnd(22)}${String(r.runs).padStart(5)}${String(r.cases).padStart(7)}   ${r.scores.join(' / ').padEnd(14)}${String(r.always).padStart(9)}${String(r.flaky).padStart(8)}${String(r.never).padStart(11)}`);
}

const tot = rows.reduce((a, r) => ({
  cases: a.cases + r.cases, always: a.always + r.always, flaky: a.flaky + r.flaky, never: a.never + r.never,
  passSum: a.passSum + r.scores.reduce((s, x) => s + x, 0), runSum: a.runSum + r.runs * r.cases,
}), { cases: 0, always: 0, flaky: 0, never: 0, passSum: 0, runSum: 0 });

console.log('\nACROSS BOTH SUITES (' + tot.cases + ' distinct scenarios)');
console.log(`  average pass rate per run        ${(100 * tot.passSum / tot.runSum).toFixed(0)}%`);
console.log(`  right EVERY time (3/3 runs)      ${tot.always} cases = ${(100 * tot.always / tot.cases).toFixed(0)}%`);
console.log(`  inconsistent (flips run to run)  ${tot.flaky} cases = ${(100 * tot.flaky / tot.cases).toFixed(0)}%`);
console.log(`  wrong EVERY time                 ${tot.never} cases = ${(100 * tot.never / tot.cases).toFixed(0)}%`);
console.log(`\n  never-pass cases: ${rows.flatMap((r) => r.neverList).join(' ')}`);
