// Stability summary: for each suite, take the last N reports and report which
// cases pass every time, fail every time, or flip. A single round's score is
// noise; the intersection is the signal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] || 3);
const files = fs.readdirSync(DIR).filter((f) => /^report_.*\.json$/.test(f)).sort();

const suiteOf = (names) => (Object.values(names).some((n) => /^[NOPQRSTU]\d\d /.test(n)) ? 'new' : 'original');
const bySuite = { original: [], new: [] };
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!j.runs || !j.names || j.runs.length < 60) continue;
    const m = {};
    for (const r of j.runs) m[(j.names[r.test_case_definition_id] || '?').slice(0, 3)] = r.status;
    bySuite[suiteOf(j.names)].push({ f, m, pass: j.job?.pass_count, total: j.job?.total_count });
  } catch {}
}

for (const [suite, list] of Object.entries(bySuite)) {
  const last = list.slice(-N);
  if (!last.length) { console.log(`\n${suite}: no reports`); continue; }
  console.log(`\n=== ${suite.toUpperCase()} SUITE — last ${last.length} runs ===`);
  console.log('  scores: ' + last.map((x) => `${x.pass}/${x.total}`).join('  '));
  const keys = [...new Set(last.flatMap((x) => Object.keys(x.m)))].sort();
  const always = [], never = [], flaky = [];
  for (const k of keys) {
    const p = last.map((x) => x.m[k] === 'pass');
    if (p.every(Boolean)) always.push(k);
    else if (p.every((v) => !v)) never.push(k);
    else flaky.push(k);
  }
  console.log(`  always pass : ${always.length}`);
  console.log(`  NEVER pass  : ${never.length}  ${never.join(' ')}`);
  console.log(`  flaky       : ${flaky.length}  ${flaky.join(' ')}`);
}
