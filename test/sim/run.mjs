// Bayton / Laura — simulation suite runner.
//
//   node run.mjs            create (or reuse) definitions, run a batch, report
//   node run.mjs --fresh    force re-creation of every definition
//   node run.mjs --only A01,I01,K02
//
// Definition ids are cached in ids.json so later rounds re-run the SAME cases
// against the updated LLM prompt (the batch carries its own response_engine).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEY, API, LLM_ID, guardBilling } from './config.mjs';
const SUITE = (process.argv.find(a=>a.endsWith('.mjs')&&a.includes('cases')) || './cases.mjs');
const cases = (await import(SUITE)).default;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const IDS = path.join(DIR, SUITE.includes('cases2') ? 'ids2.json' : 'ids.json');

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null;

async function api(pathname, body, method = 'POST') {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}/${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    return { status: r.status, json };
  }
  return { status: 0, json: 'retries exhausted' };
}

const selected = only ? cases.filter((c) => only.some((p) => c.name.startsWith(p))) : cases;
console.log(`suite: ${selected.length} case(s)${only ? ` (filtered: ${only.join(',')})` : ''}`);

// ---- 1. definitions --------------------------------------------------------
let cache = fs.existsSync(IDS) && !fresh ? JSON.parse(fs.readFileSync(IDS, 'utf8')) : {};
const ids = [];
let created = 0;
for (const c of selected) {
  if (cache[c.name]) { ids.push(cache[c.name]); continue; }
  const r = await api('create-test-case-definition', {
    name: c.name,
    response_engine: { type: 'retell-llm', llm_id: LLM_ID },
    user_prompt: c.user_prompt,
    metrics: c.metrics,
    tool_mocks: c.tool_mocks,
  });
  if (r.status >= 300) { console.error(`  ✗ ${c.name}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); continue; }
  cache[c.name] = r.json.test_case_definition_id;
  ids.push(r.json.test_case_definition_id);
  created++;
}
fs.writeFileSync(IDS, JSON.stringify(cache, null, 1));
console.log(`definitions: ${ids.length} ready (${created} newly created)`);
if (!ids.length) process.exit(1);

// ---- 2. batch --------------------------------------------------------------
const b = await api('create-batch-test', { test_case_definition_ids: ids, response_engine: { type: 'retell-llm', llm_id: LLM_ID } });
if (b.status >= 300) { console.error('batch failed:', b.status, JSON.stringify(b.json).slice(0, 400)); process.exit(1); }
const jobId = b.json.test_case_batch_job_id;
console.log(`batch ${jobId} launched, ${b.json.total_count} cases\n`);

// ---- 3. poll ---------------------------------------------------------------
let job;
const t0 = Date.now();
for (let i = 0; i < 240; i++) {
  await new Promise((s) => setTimeout(s, 10000));
  const g = await api(`get-batch-test/${jobId}`, null, 'GET');
  job = g.json;
  const el = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(`\r  t+${el}s  ${job.status}  pass ${job.pass_count} / fail ${job.fail_count} / err ${job.error_count}  of ${job.total_count}   `);
  if (job.status === 'complete') break;
}
console.log('\n');

// ---- 4. results ------------------------------------------------------------
const rr = await api(`list-test-runs/${jobId}`, null, 'GET');
const runs = Array.isArray(rr.json) ? rr.json : [];
const byId = Object.fromEntries(Object.entries(cache).map(([n, id]) => [id, n]));
runs.sort((a, b2) => (byId[a.test_case_definition_id] || '').localeCompare(byId[b2.test_case_definition_id] || ''));

const fails = runs.filter((r) => r.status !== 'pass');
console.log(`RESULT: ${job.pass_count}/${job.total_count} passed, ${job.fail_count} failed, ${job.error_count} errored\n`);

for (const r of runs) {
  const nm = byId[r.test_case_definition_id] || r.test_case_definition_id;
  console.log(`${r.status === 'pass' ? '  ok  ' : ' FAIL '} ${nm}`);
}

if (fails.length) {
  console.log('\n' + '='.repeat(78) + '\nFAILURES\n' + '='.repeat(78));
  for (const r of fails) {
    const nm = byId[r.test_case_definition_id] || r.test_case_definition_id;
    console.log(`\n### ${nm}   [${r.status}]`);
    console.log(`WHY: ${r.result_explanation}`);
    const t = r.transcript_snapshot?.transcript;
    if (Array.isArray(t)) {
      console.log('--- transcript ---');
      for (const m of t) {
        if (m.role === 'tool_call_invocation') console.log(`  [TOOL →] ${m.name} ${String(m.arguments).slice(0, 220)}`);
        else if (m.role === 'tool_call_result') console.log(`  [TOOL ←] ${String(m.content).slice(0, 160)}`);
        else console.log(`  ${(m.role || '?').toUpperCase()}: ${m.content}`);
      }
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync(path.join(DIR, `report_${stamp}.json`), JSON.stringify({ job, runs, names: byId }, null, 1));
console.log(`\nreport_${stamp}.json written`);
