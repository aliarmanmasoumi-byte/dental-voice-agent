// A/B a different LLM model against the same cases, on a CLONE — production untouched.
//   node ab.mjs <llm_id> [caseKeys,comma,separated]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';
import cases from './cases.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LLM = process.argv[2];
const keys = (process.argv[3] || 'A01,A03,A05,B03,D03,E05,F01,G01,H02,I01,K04,L01').split(',');

const api = async (p, b, m = 'POST') => {
  const r = await fetch(`${API}/${p}`, { method: m, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
};

const picked = cases.filter((c) => keys.some((k) => c.name.startsWith(k)));
console.log(`A/B model llm ${LLM} — ${picked.length} cases`);

const ids = [], names = {};
for (const c of picked) {
  const r = await api('create-test-case-definition', {
    name: `AB ${c.name}`, response_engine: { type: 'retell-llm', llm_id: LLM },
    user_prompt: c.user_prompt, metrics: c.metrics, tool_mocks: c.tool_mocks,
  });
  if (r.status >= 300) { console.error(' x', c.name, r.status, JSON.stringify(r.json).slice(0, 200)); continue; }
  ids.push(r.json.test_case_definition_id); names[r.json.test_case_definition_id] = c.name;
}
const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: LLM } });
if (b.status >= 300) { console.error('batch failed', b.status, JSON.stringify(b.json)); process.exit(1); }
const job = b.json.test_case_batch_job_id;
console.log('batch', job);

let j;
for (let i = 0; i < 120; i++) {
  await new Promise((s) => setTimeout(s, 10000));
  j = (await api(`get-batch-test/${job}`, null, 'GET')).json;
  process.stdout.write(`\r  ${j.status}  pass ${j.pass_count}/${j.total_count}   `);
  if (j.status === 'complete') break;
}
console.log('\n');

const runs = (await api(`list-test-runs/${job}`, null, 'GET')).json;
const glue = /[a-záéíóúñ?!.][?!.](?:[A-ZÁÉÍÓÚ¿¡])/;
let glued = 0, leak = 0, msgs = 0, bad = [];
for (const r of runs) {
  for (const m of r.transcript_snapshot?.transcript || []) {
    if (m.role === 'agent' || m.role === 'assistant') {
      const c = String(m.content || ''); msgs++;
      if (glue.test(c)) glued++;
      if (/\b(I must|we must|system said|developer message|the user asked|let's call|functions\.)/i.test(c)) leak++;
    }
    if (m.role === 'tool_call_invocation' && m.name === 'appointment') {
      try { const v = (JSON.parse(m.arguments).service || '').trim(); if (/^(cita|appointment|unspecified|general|visit|booking)$/i.test(v)) bad.push(v); } catch {}
    }
  }
}
console.log(`RESULT  pass ${j.pass_count}/${j.total_count}  fail ${j.fail_count}  error ${j.error_count}`);
console.log(`agent messages   : ${msgs}`);
console.log(`glued turns      : ${glued}`);
console.log(`reasoning leaks  : ${leak}`);
console.log(`placeholder svc  : ${bad.length} ${JSON.stringify(bad)}`);
fs.writeFileSync(path.join(DIR, `ab_${LLM.slice(-8)}.json`), JSON.stringify({ job: j, runs, names }, null, 1));
