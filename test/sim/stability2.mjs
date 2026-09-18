// The suites are deliberately adversarial. Split routine calls (what a clinic
// actually gets most of the time) from the edge cases and traps, so the number
// means something.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR).filter((f) => /^report_.*\.json$/.test(f)).sort();

// group prefixes -> what kind of call it represents
const ROUTINE = /^(A0[1-8]|N0[1-9]|N10|D0[12]|E0[16]|F0[15]|Q0[1567]|H0[1-8]|R0[1-9]|R10|S0[1-8]|B0[24]|P0[13]|G0[24]|J03|T03)/;
const kind = (k) => (ROUTINE.test(k) ? 'routine' : 'edge/trap');

const bySuite = { orig: [], new: [] };
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!j.runs || j.runs.length < 60) continue;
  const isNew = Object.values(j.names).some((n) => /^[NOPQRSTU]\d\d /.test(n));
  bySuite[isNew ? 'new' : 'orig'].push(j);
}

const acc = { routine: { pass: 0, total: 0, cases: new Set(), always: new Set(), ever: new Set() },
              'edge/trap': { pass: 0, total: 0, cases: new Set(), always: new Set(), ever: new Set() } };

for (const list of [bySuite.orig.slice(-3), bySuite.new.slice(-3)]) {
  const maps = list.map((j) => {
    const m = {};
    for (const r of j.runs) m[(j.names[r.test_case_definition_id] || '?').slice(0, 3)] = r.status === 'pass';
    return m;
  });
  const keys = [...new Set(maps.flatMap(Object.keys))];
  for (const k of keys) {
    const g = acc[kind(k)];
    g.cases.add(k);
    const results = maps.map((m) => m[k]).filter((x) => x !== undefined);
    g.total += results.length;
    g.pass += results.filter(Boolean).length;
    if (results.length && results.every(Boolean)) g.always.add(k);
    if (results.some(Boolean)) g.ever.add(k);
  }
}

console.log('call type     scenarios   pass rate   right every time   never right');
console.log('-'.repeat(70));
for (const [k, g] of Object.entries(acc)) {
  const rate = g.total ? (100 * g.pass / g.total).toFixed(0) + '%' : '-';
  const always = g.cases.size ? (100 * g.always.size / g.cases.size).toFixed(0) + '%' : '-';
  const never = g.cases.size - g.ever.size;
  console.log(`${k.padEnd(14)}${String(g.cases.size).padStart(9)}${rate.padStart(12)}${always.padStart(19)}${String(never).padStart(14)}`);
}

const all = Object.values(acc).reduce((a, g) => ({ pass: a.pass + g.pass, total: a.total + g.total }), { pass: 0, total: 0 });
console.log(`\noverall across both: ${(100 * all.pass / all.total).toFixed(0)}%  (${all.pass}/${all.total} graded outcomes)`);
