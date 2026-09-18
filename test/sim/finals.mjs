// Head-to-head of the sweep's best models on the FULL suite, using whatever
// prompt production currently carries. Clones only; production untouched.
//
//   node finals.mjs [suite]      suite = ./cases.mjs (default) | ./cases2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SUITE = process.argv[2] || './cases.mjs';
const MODELS = ['gpt-4.1', 'gpt-5.1', 'gpt-4.1-mini', 'claude-4.5-haiku', 'gpt-5-mini'];

const cases = (await import(SUITE)).default;

const api = async (p, b, m = 'POST') => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/${p}`, { method: m, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * (i + 1))); continue; }
    return { status: r.status, json: j };
  }
  return { status: 0, json: 'retries exhausted' };
};

const prod = (await api(`get-retell-llm/${LLM_ID}`, null, 'GET')).json;
console.log(`finals: ${MODELS.length} models x ${cases.length} cases from ${SUITE}  (prompt ${prod.general_prompt.length} chars)\n`);

const lanes = [];
for (const model of MODELS) {
  const c = await api('create-retell-llm', {
    model, model_temperature: 0,
    general_prompt: prod.general_prompt, general_tools: prod.general_tools,
    begin_message: prod.begin_message, start_speaker: prod.start_speaker,
    knowledge_base_ids: prod.knowledge_base_ids, kb_config: prod.kb_config,
  });
  if (c.status >= 300) { console.log(`  x ${model} clone: ${JSON.stringify(c.json).slice(0, 120)}`); continue; }
  const llm = c.json.llm_id;
  const ids = [], names = {};
  for (const cs of cases) {
    const d = await api('create-test-case-definition', {
      name: `FINAL ${model} ${cs.name}`, response_engine: { type: 'retell-llm', llm_id: llm },
      user_prompt: cs.user_prompt, metrics: cs.metrics, tool_mocks: cs.tool_mocks,
    });
    if (d.status < 300) { ids.push(d.json.test_case_definition_id); names[d.json.test_case_definition_id] = cs.name; }
  }
  const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: llm } });
  if (b.status >= 300) { console.log(`  x ${model} batch: ${JSON.stringify(b.json).slice(0, 120)}`); await api(`delete-retell-llm/${llm}`, null, 'DELETE'); continue; }
  lanes.push({ model, llm, job: b.json.test_case_batch_job_id, names });
  console.log(`  > ${model.padEnd(20)} launched (${ids.length})`);
}

console.log(`\npolling…`);
const done = new Set();
for (let i = 0; i < 300 && done.size < lanes.length; i++) {
  await new Promise((s) => setTimeout(s, 12000));
  for (const L of lanes) {
    if (done.has(L.model)) continue;
    L.state = (await api(`get-batch-test/${L.job}`, null, 'GET')).json;
    if (L.state.status === 'complete') { done.add(L.model); console.log(`  done ${L.model.padEnd(20)} ${L.state.pass_count}/${L.state.total_count}`); }
  }
}

const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
const rows = [];
for (const L of lanes) {
  const runs = (await api(`list-test-runs/${L.job}`, null, 'GET')).json || [];
  let glued = 0, msgs = 0, mixed = 0;
  const fails = [];
  for (const r of runs) {
    if (r.status !== 'pass') fails.push((L.names[r.test_case_definition_id] || '?').slice(0, 3));
    for (const m of r.transcript_snapshot?.transcript || []) {
      if (m.role !== 'agent' && m.role !== 'assistant') continue;
      const c = String(m.content || ''); msgs++;
      if (glue.test(c)) glued++;
      if (/[¿áéíóúñ][^]*\b(Would you|Shall I|Do you|Thank you|Goodbye)\b/.test(c) || /\b(Would you|Shall I|Do you)\b[^]*[¿áéíóúñ]/.test(c)) mixed++;
    }
  }
  const s = L.state || {};
  rows.push({ model: L.model, pass: s.pass_count ?? 0, total: s.total_count ?? 0, err: s.error_count ?? 0, msgs, glued, mixed, fails: fails.sort() });
  fs.writeFileSync(path.join(DIR, `final_${L.model.replace(/[.]/g, '')}.json`), JSON.stringify({ state: s, runs, names: L.names }, null, 1));
  await api(`delete-retell-llm/${L.llm}`, null, 'DELETE');
}

rows.sort((a, b) => b.pass - a.pass);
console.log('\nmodel                 pass    err  msgs  glued  mixed');
console.log('-'.repeat(56));
for (const r of rows) console.log(`${r.model.padEnd(20)} ${String(r.pass + '/' + r.total).padStart(6)} ${String(r.err).padStart(5)} ${String(r.msgs).padStart(5)} ${String(r.glued).padStart(6)} ${String(r.mixed).padStart(6)}`);
console.log('\nfailures per model:');
for (const r of rows) console.log(`  ${r.model.padEnd(20)} ${r.fails.join(' ')}`);
fs.writeFileSync(path.join(DIR, 'finals_results.json'), JSON.stringify(rows, null, 1));
console.log('\nclones deleted.');
