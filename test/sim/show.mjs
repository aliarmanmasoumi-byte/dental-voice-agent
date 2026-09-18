// Print the failing cases and their grader reason from a saved report file.
//   node show.mjs final_gpt-41.json
import fs from 'node:fs';

const { runs, names } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv[3] ? process.argv[3].split(',') : null;

for (const r of runs) {
  const k = (names[r.test_case_definition_id] || '?').slice(0, 3);
  if (only ? !only.includes(k) : r.status === 'pass') continue;
  const e = String(r.result_explanation || '').replace(/\s+/g, ' ');
  const s = e.split(/(?<=\.)\s+/).filter((x) => /(FAIL\)|not met|did NOT|did not|never |failed|violat)/i.test(x));
  console.log(`  ${k} [${r.status}]: ${(s[0] || e).slice(0, 250)}\n`);
}
