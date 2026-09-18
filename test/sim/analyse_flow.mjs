// Salvage a real answer from the flawed flow run: separate failures caused by
// the two build defects I already identified (the lost Spanish greeting, the
// English-only emergency line) from failures that are genuinely architectural.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : null);

const flow = [load('flow_cases.json'), load('flow_cases2.json')].filter(Boolean);
// most recent single-prompt report per suite, for the same cases
const reps = fs.readdirSync(DIR).filter((f) => /^report_.*\.json$/.test(f)).sort();
const singleFor = (wantNew) => {
  for (let i = reps.length - 1; i >= 0; i--) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, reps[i]), 'utf8'));
    if (!j.runs || j.runs.length < 60) continue;
    if (Object.values(j.names).some((n) => /^[NOPQRSTU]\d\d /.test(n)) === wantNew) return j;
  }
  return null;
};
const single = [singleFor(false), singleFor(true)].filter(Boolean);

const statusMap = (j) => {
  const m = {};
  for (const r of j.runs) m[(j.names[r.test_case_definition_id] || '?').slice(0, 3)] = r;
  return m;
};

// Did this run's failure explanation hinge on the greeting or the emergency line?
const GREET = /greeting|first agent message|opening/i;
const LANG = /Spanish|English|language/i;

let onlyFlowFails = 0, greetingRelated = 0, langRelated = 0, architectural = [];
for (let s = 0; s < flow.length; s++) {
  const F = statusMap(flow[s]);
  const S = single[s] ? statusMap(single[s]) : {};
  for (const k of Object.keys(F)) {
    const f = F[k], g = S[k];
    if (!g) continue;
    if (f.status === 'pass' || g.status !== 'pass') continue; // only: flow fails where single passes
    onlyFlowFails++;
    const why = String(f.result_explanation || '');
    if (GREET.test(why)) greetingRelated++;
    else if (LANG.test(why)) langRelated++;
    else architectural.push({ suite: s + 1, k, why: why.replace(/\s+/g, ' ').slice(0, 150) });
  }
}

console.log('Cases the FLOW failed but the single-prompt agent passed:', onlyFlowFails);
console.log(`  explanation mentions the greeting/opening : ${greetingRelated}   <- caused by my build defect`);
console.log(`  explanation mentions language             : ${langRelated}   <- greeting defect made every call open in English`);
console.log(`  neither, i.e. plausibly architectural     : ${architectural.length}\n`);
console.log('the plausibly architectural ones:');
for (const a of architectural) console.log(`  s${a.suite} ${a.k}: ${a.why}`);

// routing evidence: how often did the flow bounce between nodes?
let transitions = 0, convs = 0, backToStart = 0;
for (const j of flow) {
  for (const r of j.runs) {
    convs++;
    const t = r.transcript_snapshot?.transcript || [];
    const names = t.filter((m) => String(m.role).includes('node'));
    transitions += names.length;
    if (names.length > 6) backToStart++;
  }
}
console.log(`\nrouting: ${transitions} node transitions over ${convs} conversations (${(transitions / convs).toFixed(1)} per call)`);
console.log(`conversations with more than 6 transitions: ${backToStart}`);
