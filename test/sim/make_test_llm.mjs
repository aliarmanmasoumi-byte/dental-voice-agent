// Build (or refresh) a TEST-ONLY clone of the production LLM with the date frozen.
//
// Why: the prompt ends with {{current_time_Europe/Madrid}} / {{current_calendar_Europe/Madrid}},
// which Retell fills with the REAL date. Every case in cases.mjs / cases2.mjs is written
// against "today = Thursday 2026-08-27" and mocks that date. On 2026-09-04 the two
// disagreed, so the agent reasoned correctly from the real calendar and the grader failed
// it for not matching a stale anchor. Freezing the date in a clone fixes all 150 cases at
// once instead of rewriting their dates, and it cannot drift again.
//
//   node make_test_llm.mjs          show what would change
//   node make_test_llm.mjs --apply  create/refresh the clone, write test_llm.json
import fs from 'node:fs';
const KEY = process.env.RETELL_KEY || process.env.RETELL_API_KEY;
const API = 'https://api.retellai.com';
const SRC = 'llm_b68a4239e4d0244a3079abe0d2d7';
const APPLY = process.argv.includes('--apply');
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const call = async (p, b, m = 'GET') => { const r = await fetch(`${API}/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };

const ANCHOR = '2026-08-27';                 // Thursday — the date both suites are written against
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const rows = [];
for (let i = 0; i < 21; i++) {
  const d = new Date(Date.UTC(2026, 7, 27) + i * 86400000);
  const wd = DAYS[d.getUTCDay()];
  const iso = d.toISOString().slice(0, 10);
  const hours = wd === 'Saturday' || wd === 'Sunday' ? 'CLOSED' : (wd === 'Friday' ? '10:00-14:00' : '10:00-20:00');
  rows.push(`${iso}  ${wd}${i === 0 ? '  <- TODAY' : ''}  ${hours}`);
}
const CAL = rows.join('\n');

const src = await call(`get-retell-llm/${SRC}`);
if (src.status !== 200) { console.error('cannot read source llm', src.status); process.exit(1); }
let prompt = src.json.general_prompt;
const before = prompt.length;
if (!prompt.includes('{{current_time_Europe/Madrid}}')) { console.error('ABORT: time placeholder not found'); process.exit(1); }
prompt = prompt.replace('{{current_time_Europe/Madrid}}', `${ANCHOR} 12:00 (Thursday)`)
               .replace('{{current_calendar_Europe/Madrid}}', CAL);
console.log(`source llm v${src.json.version} | prompt ${before} -> ${prompt.length} chars | calendar rows ${rows.length}`);
console.log(rows.slice(0, 4).join('\n'));
if (!APPLY) { console.log('\n--dry: nothing created'); process.exit(0); }

const statePath = new URL('./test_llm.json', import.meta.url);
let state = null; try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
const body = { general_prompt: prompt, general_tools: src.json.general_tools, model: src.json.model,
  model_temperature: src.json.model_temperature, model_high_priority: src.json.model_high_priority,
  begin_message: src.json.begin_message, knowledge_base_ids: src.json.knowledge_base_ids };
let res;
if (state?.llm_id) { res = await call(`update-retell-llm/${state.llm_id}`, body, 'PATCH');
  if (res.status !== 200) { console.log('refresh failed, creating a new one:', res.status); state = null; } }
if (!state?.llm_id) res = await call('create-retell-llm', body, 'POST');
if (res.status >= 300) { console.error('failed', res.status, JSON.stringify(res.json).slice(0, 250)); process.exit(1); }
fs.writeFileSync(statePath, JSON.stringify({ llm_id: res.json.llm_id, version: res.json.version, anchor: ANCHOR, source_llm_version: src.json.version, refreshed_at: new Date().toISOString() }, null, 1));
console.log('TEST llm', res.json.llm_id, 'v' + res.json.version, '| anchor', ANCHOR);
