// A/B two prompts head-to-head on the same model, same cases, same moment —
// so round-to-round noise cannot explain the difference.
//   node promptab.mjs <fileA> <fileB> [./cases.mjs,./cases2.mjs]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'gpt-4.1';
const suites = (process.argv[4] || './cases.mjs,./cases2.mjs').split(',');

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
const variants = [
  { tag: 'A ' + path.basename(process.argv[2]), prompt: fs.readFileSync(process.argv[2], 'utf8') },
  { tag: 'B ' + path.basename(process.argv[3]), prompt: fs.readFileSync(process.argv[3], 'utf8') },
];
console.log(`prompt A/B on ${MODEL}: ${variants.map((v) => v.tag + ' (' + v.prompt.length + ')').join('  vs  ')}\n`);

const lanes = [];
for (const v of variants) {
  const c = await api('create-retell-llm', {
    model: MODEL, model_temperature: 0, general_prompt: v.prompt,
    general_tools: prod.general_tools, begin_message: prod.begin_message,
    start_speaker: prod.start_speaker, knowledge_base_ids: prod.knowledge_base_ids, kb_config: prod.kb_config,
  });
  if (c.status >= 300) { console.log(`  x ${v.tag}: ${JSON.stringify(c.json).slice(0, 150)}`); continue; }
  const llm = c.json.llm_id;
  for (const sfile of suites) {
    const cases = (await import(sfile)).default;
    const ids = [], names = {};
    for (const cs of cases) {
      const d = await api('create-test-case-definition', {
        name: `PAB ${v.tag} ${cs.name}`, response_engine: { type: 'retell-llm', llm_id: llm },
        user_prompt: cs.user_prompt, metrics: cs.metrics, tool_mocks: cs.tool_mocks,
      });
      if (d.status < 300) { ids.push(d.json.test_case_definition_id); names[d.json.test_case_definition_id] = cs.name; }
    }
    const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: llm } });
    if (b.status >= 300) { console.log(`  x ${v.tag} ${sfile}: ${JSON.stringify(b.json).slice(0, 150)}`); continue; }
    lanes.push({ tag: v.tag, suite: path.basename(sfile), llm, job: b.json.test_case_batch_job_id, names });
    console.log(`  > ${v.tag}  ${path.basename(sfile)}  launched (${ids.length})`);
  }
}

console.log('\npolling…');
const done = new Set();
for (let i = 0; i < 300 && done.size < lanes.length; i++) {
  await new Promise((s) => setTimeout(s, 12000));
  for (const L of lanes) {
    const k = L.tag + L.suite;
    if (done.has(k)) continue;
    L.state = (await api(`get-batch-test/${L.job}`, null, 'GET')).json;
    if (L.state.status === 'complete') { done.add(k); console.log(`  done ${L.tag} ${L.suite}: ${L.state.pass_count}/${L.state.total_count}`); }
  }
}

const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
console.log('\nvariant                       suite        pass   err  msgs  glued');
console.log('-'.repeat(68));
const out = [];
for (const L of lanes) {
  const runs = (await api(`list-test-runs/${L.job}`, null, 'GET')).json || [];
  let glued = 0, msgs = 0;
  const fails = [];
  for (const r of runs) {
    if (r.status !== 'pass') fails.push((L.names[r.test_case_definition_id] || '?').slice(0, 3));
    for (const m of r.transcript_snapshot?.transcript || []) {
      if (m.role !== 'agent' && m.role !== 'assistant') continue;
      msgs++; if (glue.test(String(m.content || ''))) glued++;
    }
  }
  const s = L.state || {};
  console.log(`${L.tag.padEnd(30)}${L.suite.padEnd(13)}${String(s.pass_count + '/' + s.total_count).padStart(6)}${String(s.error_count).padStart(6)}${String(msgs).padStart(6)}${String(glued).padStart(7)}`);
  out.push({ tag: L.tag, suite: L.suite, pass: s.pass_count, total: s.total_count, err: s.error_count, msgs, glued, fails: fails.sort() });
}
console.log('\nfailures:');
for (const o of out) console.log(`  ${o.tag} ${o.suite}: ${o.fails.join(' ')}`);
for (const llm of [...new Set(lanes.map((l) => l.llm))]) await api(`delete-retell-llm/${llm}`, null, 'DELETE');
fs.writeFileSync(path.join(DIR, 'promptab_results.json'), JSON.stringify(out, null, 1));
console.log('\nclones deleted.');
