// Runs the surgical suite against the DATE-FROZEN test LLM and dumps full transcripts.
// Retell's own metrics are deliberately not consulted — grading happens by reading these.
import fs from 'node:fs';
const KEY = process.env.RETELL_KEY || process.env.RETELL_API_KEY;
const API = 'https://api.retellai.com';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const api = async (p, b, m = 'POST') => { const r = await fetch(`${API}/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };
const LLM = JSON.parse(fs.readFileSync('./test_llm.json', 'utf8')).llm_id;
const cases = (await import('./cases_surgical.mjs')).default;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const sel = only ? cases.filter(c => only.some(p => c.name.startsWith(p))) : cases;
const IDS = './ids_surgical.json';
let cache = {}; try { cache = JSON.parse(fs.readFileSync(IDS, 'utf8')); } catch {}
if (process.argv.includes('--fresh')) cache = {};
const ids = [];
for (const c of sel) {
  if (cache[c.name]) { ids.push(cache[c.name]); continue; }
  const r = await api('create-test-case-definition', { name: c.name, response_engine: { type: 'retell-llm', llm_id: LLM }, user_prompt: c.user_prompt, metrics: c.metrics, tool_mocks: c.tool_mocks });
  if (r.status >= 300) { console.error(`  x ${c.name}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); continue; }
  cache[c.name] = r.json.test_case_definition_id; ids.push(r.json.test_case_definition_id);
}
fs.writeFileSync(IDS, JSON.stringify(cache, null, 1));
console.log(`llm ${LLM} | ${ids.length} definitions ready`);
if (!ids.length) process.exit(1);
const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: LLM } });
if (b.status >= 300) { console.error('batch failed', b.status, JSON.stringify(b.json).slice(0, 300)); process.exit(1); }
const id = b.json.test_case_batch_job_id; console.log('batch', id, 'launched');
let job;
for (let i = 0; i < 200; i++) { await new Promise(s => setTimeout(s, 10000)); job = (await api(`get-batch-test/${id}`, null, 'GET')).json;
  process.stdout.write(`\r  ${job.status}  ${job.pass_count}p/${job.fail_count}f/${job.error_count}e of ${job.total_count}   `); if (job.status === 'complete') break; }
const runs = (await api(`list-test-runs/${id}`, null, 'GET')).json;
const byId = Object.fromEntries(Object.entries(cache).map(([n, i]) => [i, n]));
const out = [];
for (const r of (Array.isArray(runs) ? runs : [])) {
  const nm = byId[r.test_case_definition_id] || '?';
  const t = r.transcript_snapshot?.transcript || [];
  out.push({ name: nm, status: r.status, turns: t });
}
out.sort((a, b2) => a.name.localeCompare(b2.name));
fs.writeFileSync('./surgical_transcripts.json', JSON.stringify(out, null, 1));
console.log('\n\n--- tool calls per case (for my own grading) ---');
for (const o of out) {
  const tools = o.turns.filter(x => x.role === 'tool_call_invocation').map(x => x.name);
  console.log(`${o.name.slice(0, 34).padEnd(35)} ${String(o.status).padEnd(6)} ${tools.join(' > ') || '(none)'}`);
}
console.log('\ntranscripts -> surgical_transcripts.json');
