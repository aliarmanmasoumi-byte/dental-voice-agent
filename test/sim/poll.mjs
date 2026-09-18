// Attach to a batch that is already running server-side and report it.
//   node poll.mjs <batch_job_id> <ids.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const job = process.argv[2];
const cache = JSON.parse(fs.readFileSync(path.join(DIR, process.argv[3] || 'ids.json'), 'utf8'));
const byId = Object.fromEntries(Object.entries(cache).map(([n, id]) => [id, n]));

const api = async (p) => {
  const r = await fetch(`${API}/${p}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
};

let state;
for (let i = 0; i < 200; i++) {
  state = await api(`get-batch-test/${job}`);
  process.stdout.write(`\r  ${state.status}  pass ${state.pass_count} / fail ${state.fail_count} / err ${state.error_count}  of ${state.total_count}   `);
  if (state.status === 'complete') break;
  await new Promise((s) => setTimeout(s, 10000));
}
console.log('\n');
console.log(`RESULT: ${state.pass_count}/${state.total_count} passed, ${state.fail_count} failed, ${state.error_count} errored\n`);

const runs = (await api(`list-test-runs/${job}`)) || [];
const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
let glued = 0, msgs = 0;
for (const r of runs) for (const m of r.transcript_snapshot?.transcript || []) {
  if (m.role !== 'agent' && m.role !== 'assistant') continue;
  msgs++; if (glue.test(String(m.content || ''))) glued++;
}
console.log(`output hygiene: ${msgs} agent messages, ${glued} glued`);
console.log('failing: ' + runs.filter((r) => r.status !== 'pass').map((r) => (byId[r.test_case_definition_id] || '?').slice(0, 3) + '(' + r.status[0] + ')').sort().join(' '));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync(path.join(DIR, `report_${stamp}.json`), JSON.stringify({ job: state, runs, names: byId }, null, 1));
console.log(`\nreport_${stamp}.json written`);
