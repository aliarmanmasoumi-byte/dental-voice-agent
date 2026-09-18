// Deploy the frozen Retell-final Laura agent into a fresh Retell account,
// and point the clinic's Twilio number at it.
//
//   node deploy.mjs                 dry run  — show what would happen, change nothing
//   node deploy.mjs --apply         create knowledge base + LLM + agent
//   node deploy.mjs --number        move ${CLINIC_PHONE_US} onto the new agent
//   node deploy.mjs --verify        compare what landed against agent/
//   node deploy.mjs --status        one-screen health check of the live deployment
//
// Source of truth is agent/ (FROZEN — 69/75 and 60/75 in the
// two simulation suites). Nothing here edits it.
//
// What deliberately does NOT come across:
//   voice_id  — custom_voice_3f02e539… is an ElevenLabs clone that only exists in
//               account #1. Custom voices are dashboard-only, so a stock Castilian
//               female stands in until the clone is recreated by hand.
//
// Ids of whatever this script creates are written to deployed.json, which is what
// --number, --verify and --status read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(DIR, '..', 'agent');
const KBDIR = path.join(DIR, '..', 'agent', 'knowledge-base');
const STATE = path.join(DIR, 'deployed.json');
const API = 'https://api.retellai.com';

// ---------------------------------------------------------------- config
const KEY = process.env.RETELL_KEY || process.env.RETELL_API_KEY; // account #4
// RETELL_KEY_OLD is the account that still holds the phone number

const AGENT_NAME = 'Laura — Bayton Dental';
const VOICE_ID = 'cartesia-Isabel'; // Castilian female stand-in; swap in the dashboard
const HIGH_PRIORITY = true;         // dedicated model capacity — lower LLM latency

// Twilio (our own account — the number is NOT Retell-provisioned)
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TRUNK = process.env.TWILIO_TRUNK_SID; // "my retell"
const PN_SID = process.env.TWILIO_PHONE_SID;
const NUMBER = process.env.CLINIC_PHONE_US;
const TERMINATION_URI = process.env.TWILIO_TERMINATION_URI;
const SIP_CRED_LIST = process.env.TWILIO_SIP_CRED_LIST; // "arman retell"
const SIP_USER = process.env.SIP_USERNAME;

// ---------------------------------------------------------------- helpers
const twAuth = 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');

async function rt(p, body, method = 'POST', key = KEY) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/${p}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * (i + 1))); continue; }
    return { status: r.status, json: j };
  }
  return { status: 0, json: 'retries exhausted' };
}

async function tw(url, body, method = 'GET') {
  const r = await fetch(url, {
    method,
    headers: { Authorization: twAuth, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const writeState = (o) => fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...o }, null, 1));
const ok = (s) => s < 300;
const die = (m) => { console.error(`\n  FAILED: ${m}`); process.exit(1); };

async function numberState() {
  const r = await tw(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/IncomingPhoneNumbers/${PN_SID}.json`);
  return { number: r.json.phone_number, trunk_sid: r.json.trunk_sid, voice_url: r.json.voice_url };
}

// ---------------------------------------------------------------- commands
const mode = process.argv[2] || '--dry';

// ---- create knowledge base + LLM + agent -------------------------------
if (mode === '--apply' || mode === '--dry') {
  const dry = mode === '--dry';
  const llm = JSON.parse(fs.readFileSync(path.join(SRC, 'llm.json'), 'utf8'));
  const agent = JSON.parse(fs.readFileSync(path.join(SRC, 'agent.json'), 'utf8'));
  const docs = fs.readdirSync(KBDIR).filter((f) => f.endsWith('.txt'));

  console.log(`source   ${path.relative(DIR, SRC)}`);
  console.log(`prompt   ${llm.general_prompt.length} chars`);
  console.log(`model    ${llm.model} @ temp ${llm.model_temperature}${HIGH_PRIORITY ? ' (high priority)' : ''}`);
  console.log(`tools    ${llm.general_tools.length}`);
  console.log(`kb       ${docs.length} docs — ${docs.join(', ')}`);
  console.log(`voice    ${agent.voice_id} -> ${VOICE_ID}`);
  console.log(`language ${JSON.stringify(agent.language)}\n`);
  if (dry) { console.log('dry run — nothing created. Re-run with --apply.'); process.exit(0); }

  const existing = await rt('list-agents', null, 'GET');
  if (ok(existing.status) && existing.json.length) {
    console.log(`  ! account already has ${existing.json.length} agent(s):`);
    for (const a of existing.json) console.log(`      ${a.agent_id}  ${a.agent_name}`);
    console.log('    creating another one anyway — delete the stale ones by hand if this was a re-run.\n');
  }

  // 1. knowledge base
  const form = new FormData();
  form.append('knowledge_base_name', 'Bayton Dental');
  for (const f of docs) form.append('knowledge_base_files', new Blob([fs.readFileSync(path.join(KBDIR, f))], { type: 'text/plain' }), f);
  const kr = await fetch(`${API}/create-knowledge-base`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
  const kj = await kr.json().catch(() => ({}));
  if (!ok(kr.status)) die(`knowledge base: ${kr.status} ${JSON.stringify(kj).slice(0, 300)}`);
  const kbId = kj.knowledge_base_id;
  console.log(`  ok knowledge base  ${kbId}`);

  // 2. LLM
  const l = await rt('create-retell-llm', {
    model: llm.model,
    model_temperature: llm.model_temperature,
    model_high_priority: HIGH_PRIORITY,
    general_prompt: llm.general_prompt,
    general_tools: llm.general_tools,
    begin_message: llm.begin_message,
    start_speaker: llm.start_speaker,
    kb_config: llm.kb_config,
    knowledge_base_ids: [kbId],
  });
  if (!ok(l.status)) die(`llm: ${l.status} ${JSON.stringify(l.json).slice(0, 400)}`);
  console.log(`  ok llm             ${l.json.llm_id}`);

  // 3. agent — every tuned field except ids that belong to the old account
  const skip = new Set(['agent_id', 'response_engine', 'last_modification_timestamp', 'version',
    'is_published', 'knowledge_base_ids', 'agent_name', 'voice_id']);
  const body = {
    agent_name: AGENT_NAME,
    voice_id: VOICE_ID,
    response_engine: { type: 'retell-llm', llm_id: l.json.llm_id },
  };
  for (const [k, v] of Object.entries(agent)) if (!skip.has(k) && v !== null && v !== undefined) body[k] = v;
  const a = await rt('create-agent', body);
  if (!ok(a.status)) die(`agent: ${a.status} ${JSON.stringify(a.json).slice(0, 500)}`);
  console.log(`  ok agent           ${a.json.agent_id}`);

  writeState({ key_tail: KEY.slice(-6), knowledge_base_id: kbId, llm_id: l.json.llm_id, agent_id: a.json.agent_id, deployed_at: new Date().toISOString() });
  console.log(`\nids -> ${path.relative(DIR, STATE)}`);
  console.log('next: node deploy.mjs --number');
}

// ---- point the phone number at the new agent ---------------------------
if (mode === '--number') await moveNumber();

async function moveNumber() {
  const st = readState();
  if (!st.agent_id) die('no deployed.json — run --apply first');

  // Gate: never move the clinic's live line onto an account that cannot take a
  // call. A suspended or unfunded org answers config reads and writes perfectly
  // and only fails on the billed path, so this has to be probed explicitly.
  const probe = await rt('v2/create-web-call', { agent_id: st.agent_id });
  if (!ok(probe.status)) {
    console.error(`\n  BLOCKED: this Retell account cannot place calls.`);
    console.error(`  v2/create-web-call -> ${probe.status} ${JSON.stringify(probe.json)}`);
    console.error(`\n  Moving ${NUMBER} here would take the clinic line down. Fix the account`);
    console.error(`  first, then re-run. Override with --number --force only if you know why.`);
    if (process.argv[3] !== '--force') { process.exitCode = 1; return; }
    console.error('  --force given, continuing anyway.\n');
  } else {
    console.log(`0) account can place calls -> OK`);
  }

  console.log('before:', JSON.stringify(await numberState()));

  // 1. release the number from Retell account #1, which still holds it
  const oldKey = process.env.RETELL_KEY_OLD;
  const held = await rt('list-phone-numbers', null, 'GET', oldKey);
  if (ok(held.status) && held.json.some?.((n) => n.phone_number === NUMBER)) {
    const d = await rt(`delete-phone-number/${NUMBER}`, null, 'DELETE', oldKey);
    console.log(`1) release from Retell account #1 -> ${d.status} ${ok(d.status) ? 'OK' : JSON.stringify(d.json).slice(0, 200)}`);
    if (!ok(d.status)) die('account #1 still holds the number; Retell will refuse the import');
  } else console.log('1) release from Retell account #1 -> not held, skipping');

  // 2. reset the SIP credential so outbound calls can authenticate (Twilio never
  //    returns an existing password, so the only way to know it is to set it)
  const pass = `Bay${Math.random().toString(36).slice(2, 10)}Ret${Math.random().toString(36).slice(2, 6).toUpperCase()}1!`;
  const cr = await tw(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/SIP/CredentialLists/${SIP_CRED_LIST}/Credentials.json`);
  const cred = (cr.json.credentials || []).find((c) => c.username === SIP_USER);
  if (!cred) die(`SIP credential ${SIP_USER} not found in credential list`);
  const up = await tw(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/SIP/CredentialLists/${SIP_CRED_LIST}/Credentials/${cred.sid}.json`, { Password: pass }, 'POST');
  console.log(`2) reset SIP password for ${SIP_USER} -> ${up.status} ${ok(up.status) ? 'OK' : JSON.stringify(up.json).slice(0, 200)}`);
  // Save it NOW: Twilio never reads a password back, so if a later step throws
  // the only copy is lost and the credential has to be reset all over again.
  writeState({ sip_user: SIP_USER, sip_pass: pass });

  // 3. import into the new account, bound to the new agent.
  //    Both *_agent_id fields are deprecated (410 since 2026-03-31) — a phone
  //    number takes weighted agent LISTS whose weights sum to 1.
  const imp = await rt('import-phone-number', {
    phone_number: NUMBER,
    termination_uri: TERMINATION_URI,
    sip_trunk_auth_username: SIP_USER,
    sip_trunk_auth_password: pass,
    inbound_agents: [{ agent_id: st.agent_id, weight: 1 }],
    outbound_agents: [{ agent_id: st.agent_id, weight: 1 }],
    nickname: 'Bayton Dental — main line',
  });
  if (!ok(imp.status)) die(`import: ${imp.status} ${JSON.stringify(imp.json).slice(0, 400)}`);
  console.log(`3) import into the new Retell account -> ${imp.status} OK`);

  // 4. bind the number to the trunk. While trunk_sid is set Twilio routes to the
  //    trunk and IGNORES voice_url, so this is what takes it off the platform.
  const bind = await tw(`https://trunking.twilio.com/v1/Trunks/${TRUNK}/PhoneNumbers`, { PhoneNumberSid: PN_SID }, 'POST');
  console.log(`4) bind to Twilio trunk "my retell" -> ${bind.status} ${ok(bind.status) ? 'OK' : JSON.stringify(bind.json).slice(0, 200)}`);

  writeState({ phone_number: NUMBER, sip_user: SIP_USER, sip_pass: pass, number_moved_at: new Date().toISOString() });
  console.log('after: ', JSON.stringify(await numberState()));
  console.log('\nrevert to the Ambition AI platform: node move_number.mjs --apply');
}

// ---- verify against the frozen source ----------------------------------
if (mode === '--verify') {
  const st = readState();
  if (!st.agent_id) die('no deployed.json — run --apply first');
  const src = JSON.parse(fs.readFileSync(path.join(SRC, 'llm.json'), 'utf8'));
  const sa = JSON.parse(fs.readFileSync(path.join(SRC, 'agent.json'), 'utf8'));
  const nl = (await rt(`get-retell-llm/${st.llm_id}`, null, 'GET')).json;
  const na = (await rt(`get-agent/${st.agent_id}`, null, 'GET')).json;

  const stableJson = (o) =>
    o == null ? String(o) : JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));

  const rows = [
    ['model', src.model, nl.model],
    ['temperature', src.model_temperature, nl.model_temperature],
    ['prompt chars', src.general_prompt.length, nl.general_prompt?.length],
    ['prompt identical', 'yes', src.general_prompt === nl.general_prompt ? 'yes' : 'NO'],
    ['tools', src.general_tools.length, nl.general_tools?.length],
    ['begin_message', src.begin_message, nl.begin_message],
    ['start_speaker', src.start_speaker, nl.start_speaker],
    ['kb attached', 1, (nl.knowledge_base_ids || []).length],
    // Sort keys before stringifying: Retell echoes this object back with the keys
    // in a different order, which a raw JSON.stringify compare reports as a diff.
    ['kb_config', stableJson(src.kb_config), stableJson(nl.kb_config)],
    ['language', JSON.stringify(sa.language), JSON.stringify(na.language)],
    ['stt_mode', sa.stt_mode, na.stt_mode],
    ['custom_stt', JSON.stringify(sa.custom_stt_config), JSON.stringify(na.custom_stt_config)],
    ['denoising', sa.denoising_mode, na.denoising_mode],
    ['responsiveness', sa.responsiveness, na.responsiveness],
    ['interruption', sa.interruption_sensitivity, na.interruption_sensitivity],
    ['vocab', sa.vocab_specialization, na.vocab_specialization],
    ['boosted kw', (sa.boosted_keywords || []).length, (na.boosted_keywords || []).length],
    ['max duration', sa.max_call_duration_ms, na.max_call_duration_ms],
    ['silence hangup', sa.end_call_after_silence_ms, na.end_call_after_silence_ms],
    ['dtmf', sa.allow_user_dtmf, na.allow_user_dtmf],
  ];
  let bad = 0;
  for (const [k, o, n] of rows) {
    const same = String(o) === String(n);
    if (!same) bad++;
    console.log(`${same ? ' ok ' : ' !! '}${k.padEnd(17)}${String(o).slice(0, 34).padEnd(35)}${String(n).slice(0, 34)}`);
  }
  console.log(` --  ${'voice_id'.padEnd(17)}${String(sa.voice_id).slice(0, 34).padEnd(35)}${na.voice_id}   (intentional)`);
  console.log(`\n${bad === 0 ? 'matches the frozen config' : bad + ' field(s) differ'}`);

  const names = (nl.general_tools || []).map((t) => t.name).join(', ');
  console.log(`tools: ${names}`);
}

// ---- one-screen health check -------------------------------------------
if (mode === '--status') {
  const st = readState();
  const num = await rt('list-phone-numbers', null, 'GET');
  const ag = await rt('list-agents', null, 'GET');
  const tws = await numberState();

  console.log('RETELL  account key …' + KEY.slice(-6));
  for (const a of (ag.json || [])) console.log(`  agent   ${a.agent_id}  ${a.agent_name}`);
  for (const n of (num.json || [])) {
    const inb = n.inbound_agents?.[0]?.agent_id || n.inbound_agent_id || '(none)';
    console.log(`  number  ${n.phone_number}  inbound -> ${inb}`);
  }
  console.log('\nTWILIO  ' + tws.number);
  console.log(`  trunk_sid  ${tws.trunk_sid || '(none)'}${tws.trunk_sid === TRUNK ? '  = "my retell" -> Retell' : ''}`);
  console.log(`  voice_url  ${tws.voice_url || '(none)'}${tws.trunk_sid ? '   (ignored while a trunk is bound)' : ''}`);

  const routed = tws.trunk_sid === TRUNK && (num.json || []).some((n) => n.phone_number === NUMBER);
  console.log(`\nrouting: ${routed ? `calls to ${NUMBER} reach the Retell agent` : 'NOT routed to this Retell account'}`);

  // live-call smoke check: does the account actually have credit?
  if (st.agent_id) {
    const c = await rt('v2/create-web-call', { agent_id: st.agent_id });
    console.log(`credit : create-web-call -> ${c.status} ${ok(c.status) ? 'OK, account can place calls' : JSON.stringify(c.json).slice(0, 200)}`);
  }
}
