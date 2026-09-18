// Model sweep: run the SAME case subset against every candidate Retell model on
// throwaway clone LLMs, score pass rate plus the output-hygiene defects that
// prompt rules could not fix. Production is never touched; clones are deleted.
//
//   node sweep.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';
import cases from './cases.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// covers language, booking, tool discipline, endings, KB — the places it breaks
const KEYS = ['A01', 'A03', 'B08', 'C01', 'C05', 'D01', 'F04', 'H02', 'I01', 'I02', 'I03', 'I05', 'J01', 'K04', 'K05'];

const MODELS = [
  'gpt-5-mini', 'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5',
  'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-4.1', 'gpt-4.1-mini',
  'claude-4.5-haiku', 'claude-4.5-sonnet', 'claude-4.6-sonnet', 'claude-5-sonnet',
  'gemini-3.0-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash',
];

const api = async (p, b, m = 'POST') => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/${p}`, { method: m, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * (i + 1))); continue; }
    return { status: r.status, json: j };
  }
  return { status: 0, json: 'retries exhausted' };
};

const picked = cases.filter((c) => KEYS.some((k) => c.name.startsWith(k)));
const prod = (await api(`get-retell-llm/${LLM_ID}`, null, 'GET')).json;
console.log(`sweep: ${MODELS.length} models x ${picked.length} cases  (prompt ${prod.general_prompt.length} chars)\n`);

// ---- 1. clone one LLM per model, build its definitions, launch its batch ----
const lanes = [];
for (const model of MODELS) {
  const c = await api('create-retell-llm', {
    model, model_temperature: 0,
    general_prompt: prod.general_prompt, general_tools: prod.general_tools,
    begin_message: prod.begin_message, start_speaker: prod.start_speaker,
    knowledge_base_ids: prod.knowledge_base_ids, kb_config: prod.kb_config,
  });
  if (c.status >= 300) { console.log(`  x ${model.padEnd(22)} clone failed: ${JSON.stringify(c.json).slice(0, 120)}`); continue; }
  const llm = c.json.llm_id;
  const ids = [], names = {};
  for (const cs of picked) {
    const d = await api('create-test-case-definition', {
      name: `SWEEP ${model} ${cs.name}`, response_engine: { type: 'retell-llm', llm_id: llm },
      user_prompt: cs.user_prompt, metrics: cs.metrics, tool_mocks: cs.tool_mocks,
    });
    if (d.status < 300) { ids.push(d.json.test_case_definition_id); names[d.json.test_case_definition_id] = cs.name; }
  }
  const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: llm } });
  if (b.status >= 300) { console.log(`  x ${model.padEnd(22)} batch failed: ${JSON.stringify(b.json).slice(0, 120)}`); await api(`delete-retell-llm/${llm}`, null, 'DELETE'); continue; }
  lanes.push({ model, llm, job: b.json.test_case_batch_job_id, names });
  console.log(`  > ${model.padEnd(22)} launched (${ids.length} cases)`);
}

// ---- 2. poll them all ----
console.log(`\npolling ${lanes.length} batches…`);
const done = new Set();
for (let i = 0; i < 200 && done.size < lanes.length; i++) {
  await new Promise((s) => setTimeout(s, 10000));
  for (const L of lanes) {
    if (done.has(L.model)) continue;
    const g = (await api(`get-batch-test/${L.job}`, null, 'GET')).json;
    L.job_state = g;
    if (g.status === 'complete') { done.add(L.model); process.stdout.write(`\r  done ${done.size}/${lanes.length}  (${L.model})            `); }
  }
}
console.log('\n');

// ---- 3. score ----
const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
const leakRe = /\b(I must|we must|system said|developer message|let's call|functions\.|criterion)/i;
const rows = [];
for (const L of lanes) {
  const runs = (await api(`list-test-runs/${L.job}`, null, 'GET')).json;
  let glued = 0, leaks = 0, msgs = 0, mixed = 0;
  for (const r of runs || []) {
    for (const m of r.transcript_snapshot?.transcript || []) {
      if (m.role !== 'agent' && m.role !== 'assistant') continue;
      const c = String(m.content || ''); msgs++;
      if (glue.test(c)) glued++;
      if (leakRe.test(c)) leaks++;
      // a Spanish question immediately followed by an English one, or vice versa
      if (/[¿áéíóúñ][^]*\b(Would you|Shall I|Do you|Please|Thank you|Goodbye)\b/.test(c) || /\b(Would you|Shall I|Do you)\b[^]*[¿áéíóúñ]/.test(c)) mixed++;
    }
  }
  const s = L.job_state || {};
  rows.push({ model: L.model, pass: s.pass_count ?? 0, total: s.total_count ?? 0, fail: s.fail_count ?? 0, err: s.error_count ?? 0, msgs, glued, leaks, mixed });
  await api(`delete-retell-llm/${L.llm}`, null, 'DELETE');
}

rows.sort((a, b) => (b.pass - a.pass) || (a.glued + a.mixed) - (b.glued + b.mixed));
console.log('model                    pass   err  msgs  glued  leaks  mixed');
console.log('-'.repeat(64));
for (const r of rows) {
  console.log(`${r.model.padEnd(24)} ${String(r.pass + '/' + r.total).padStart(5)} ${String(r.err).padStart(5)} ${String(r.msgs).padStart(5)} ${String(r.glued).padStart(6)} ${String(r.leaks).padStart(6)} ${String(r.mixed).padStart(6)}`);
}
fs.writeFileSync(path.join(DIR, 'sweep_results.json'), JSON.stringify(rows, null, 1));
console.log('\nclones deleted. sweep_results.json written');
