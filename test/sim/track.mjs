// Track specific cases across the last N reports of their suite.
//   node track.mjs 4 L06,I01,U04,U12,Q06,S01,R08
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] || 4);
const keys = (process.argv[3] || '').split(',').filter(Boolean);
const files = fs.readdirSync(DIR).filter((f) => /^report_.*\.json$/.test(f)).sort();

const rows = [];
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!j.runs || !j.names || j.runs.length < 60) continue;
    const m = {};
    for (const r of j.runs) m[(j.names[r.test_case_definition_id] || '?').slice(0, 3)] = r.status;
    rows.push({ suite: Object.values(j.names).some((n) => /^[NOPQRSTU]\d\d /.test(n)) ? 'new' : 'orig', m });
  } catch {}
}

for (const k of keys) {
  const rel = rows.filter((r) => k in r.m).slice(-N);
  console.log(`  ${k}: ${rel.map((r) => r.m[k][0]).join(' ')}   (${rel[0]?.suite ?? '?'} suite, oldest→newest)`);
}
