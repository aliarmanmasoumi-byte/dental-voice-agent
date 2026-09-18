// Print the transcript of one case from a saved report.
//   node tx.mjs final_gpt-41.json H02 [maxTurns]
import fs from 'node:fs';

const { runs, names } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const key = process.argv[3];
const max = Number(process.argv[4] || 30);
const r = runs.find((x) => (names[x.test_case_definition_id] || '').startsWith(key));
if (!r) { console.log('not found'); process.exit(0); }

console.log(`${names[r.test_case_definition_id]}  [${r.status}]`);
const t = r.transcript_snapshot?.transcript || [];
console.log(`${t.length} turns\n`);
for (const m of t.slice(0, max)) {
  if (m.role === 'tool_call_invocation') console.log(`  [TOOL >] ${m.name} ${String(m.arguments).slice(0, 110)}`);
  else if (m.role === 'tool_call_result') console.log(`  [TOOL <] ${String(m.content).slice(0, 110)}`);
  else console.log(`  ${(m.role || '?').toUpperCase()}: ${String(m.content).slice(0, 210)}`);
}
