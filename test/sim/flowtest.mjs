// Run the SAME suites against the conversation-flow agent, so the single-prompt
// and per-node-prompt designs are compared on identical cases and mocks.
//   node flowtest.mjs [./cases.mjs,./cases2.mjs]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './config.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const flowId = JSON.parse(fs.readFileSync(path.join(DIR, 'flow_id.json'), 'utf8')).conversation_flow_id;
const engine = { type: 'conversation-flow', conversation_flow_id: flowId };
const suites = (process.argv[2] || './cases.mjs,./cases2.mjs').split(',');

console.log(`flow test: ${flowId}\n`);

const lanes = [];
for (const sfile of suites) {
  const cases = (await import(sfile)).default;
  const ids = [], names = {};
  for (const cs of cases) {
    const d = await api('create-test-case-definition', {
      name: `FLOW ${cs.name}`, response_engine: engine,
      user_prompt: cs.user_prompt, metrics: cs.metrics, tool_mocks: cs.tool_mocks,
    });
    if (d.status < 300) { ids.push(d.json.test_case_definition_id); names[d.json.test_case_definition_id] = cs.name; }
    else if (ids.length === 0) { console.error(`  x definition: ${d.status} ${JSON.stringify(d.json).slice(0, 300)}`); process.exit(1); }
  }
  const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: engine });
  if (b.status >= 300) { console.error(`  x batch ${sfile}: ${b.status} ${JSON.stringify(b.json).slice(0, 300)}`); continue; }
  lanes.push({ suite: path.basename(sfile), job: b.json.test_case_batch_job_id, names });
  console.log(`  > ${path.basename(sfile)} launched (${ids.length})`);
}

console.log('\npolling…');
const done = new Set();
for (let i = 0; i < 300 && done.size < lanes.length; i++) {
  await new Promise((s) => setTimeout(s, 12000));
  for (const L of lanes) {
    if (done.has(L.suite)) continue;
    L.state = (await api(`get-batch-test/${L.job}`, null, 'GET')).json;
    if (L.state.status === 'complete') { done.add(L.suite); console.log(`  done ${L.suite}: ${L.state.pass_count}/${L.state.total_count}`); }
  }
}

const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
console.log('\nsuite         pass    err  msgs  glued   turns/conv');
console.log('-'.repeat(56));
const out = [];
for (const L of lanes) {
  const runs = (await api(`list-test-runs/${L.job}`, null, 'GET')).json || [];
  let glued = 0, msgs = 0, turns = 0;
  const fails = [];
  for (const r of runs) {
    if (r.status !== 'pass') fails.push((L.names[r.test_case_definition_id] || '?').slice(0, 3));
    for (const m of r.transcript_snapshot?.transcript || []) {
      turns++;
      if (m.role !== 'agent' && m.role !== 'assistant') continue;
      msgs++; if (glue.test(String(m.content || ''))) glued++;
    }
  }
  const s = L.state || {};
  const tpc = runs.length ? (turns / runs.length).toFixed(1) : '-';
  console.log(`${L.suite.padEnd(14)}${String(s.pass_count + '/' + s.total_count).padStart(6)}${String(s.error_count).padStart(6)}${String(msgs).padStart(6)}${String(glued).padStart(7)}${String(tpc).padStart(12)}`);
  out.push({ suite: L.suite, pass: s.pass_count, total: s.total_count, err: s.error_count, msgs, glued, turnsPerConv: tpc, fails: fails.sort() });
  fs.writeFileSync(path.join(DIR, `flow_${L.suite.replace('.mjs', '')}.json`), JSON.stringify({ state: s, runs, names: L.names }, null, 1));
}
console.log('\nfailures:');
for (const o of out) console.log(`  ${o.suite}: ${o.fails.join(' ')}`);
fs.writeFileSync(path.join(DIR, 'flow_results.json'), JSON.stringify(out, null, 1));
