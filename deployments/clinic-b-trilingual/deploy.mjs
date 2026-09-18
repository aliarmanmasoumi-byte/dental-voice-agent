// Clinica Dental Ejemplo — duplicate of the live Bayton agent on Retell account #5,
// re-pointed at Clinica Ejemplo and with Mandarin Chinese added as a third language.
//
//   node deploy_ds30.mjs --dry     read the source agent, show what would be sent
//   node deploy_ds30.mjs --apply   create kb + llm + agent, write deployed_ds30.json
//   node deploy_ds30.mjs --verify  diff the live Clinica Ejemplo agent against what this builds
//
// The booking TOOLS are copied verbatim, so they still hit Bayton's n8n webhook.
// Give Clinica Ejemplo its own workflow + calendar before any real booking is taken.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.RETELL_KEY || process.env.RETELL_API_KEY;
const API = 'https://api.retellai.com';
const STATE = path.join(DIR, 'deployed_ds30.json');

const SRC_AGENT = 'agent_9b5e2fe8dc2124be4c8c0c505c';   // Laura — Bayton Dental (live)
const AGENT_NAME = 'Laura — Clinica Dental Ejemplo';
const KB_NAME = 'Clinica Dental Ejemplo';
const BEGIN = 'Clinica Dental Ejemplo, soy Laura. ¿En qué puedo ayudarle?';
const LANGUAGES = ['es-ES', 'en-US', 'zh-CN'];

// Cross-lingual retrieval scores lower than same-language: a Chinese question
// against Spanish KB text sits well under Retell's 0.45 Bayton threshold.
const KB_CONFIG = { top_k: 6, filter_score: 0.3 };

// Retell caps boosted_keywords at 100 entries; the Bayton list is 85, so only
// the highest-value Chinese terms fit. Ordered by how much a miss would cost.
const KEYWORD_CAP = 100;
const ZH_KEYWORDS = ['预约', '牙医', '牙科', '看牙', '取消预约', '改时间', '营业时间',
  '地址', '多少钱', '洗牙', '补牙', '拔牙', '牙疼', '种植牙', '正畸', '牙齿矫正',
  '隐形牙套', '牙齿美白', '根管治疗', '儿童牙科', '免费', '明天', '今天', '几点',
  '上午', '下午', '诊所', '挂号', '蛀牙', '牙龈', '价格', '第一次', '下星期'];

const mode = process.argv.find((a) => a.startsWith('--')) || '--dry';
const die = (m) => { console.error('\n' + m); process.exit(1); };
const ok = (s) => s >= 200 && s < 300;

const rt = async (p, body, method) => {
  const r = await fetch(`${API}/${p}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
};

// ---- build the Clinica Ejemplo config from the live Bayton one ----------------------
async function build() {
  const a = await rt(`get-agent/${SRC_AGENT}`);
  if (!ok(a.status)) die(`source agent: ${a.status} ${JSON.stringify(a.json).slice(0, 300)}`);
  const l = await rt(`get-retell-llm/${a.json.response_engine.llm_id}`);
  if (!ok(l.status)) die(`source llm: ${l.status}`);

  const prompt = fs.readFileSync(path.join(DIR, 'prompt_ds30.txt'), 'utf8');
  if (/Bayton/i.test(prompt)) die('prompt_ds30.txt still mentions Bayton — run build_prompt.mjs');

  // The tool execution messages name the two languages explicitly; add Chinese.
  const tools = JSON.parse(JSON.stringify(l.json.general_tools));
  let patched = 0;
  const FIND = '(English if they speak English, Spanish if they speak Spanish)';
  const REPL = '(English if they speak English, Spanish if they speak Spanish, Mandarin Chinese if they speak Chinese)';
  for (const t of tools) {
    if (t.execution_message_description?.includes(FIND)) {
      t.execution_message_description = t.execution_message_description.split(FIND).join(REPL);
      patched++;
    }
  }

  const agentSkip = new Set(['agent_id', 'response_engine', 'last_modification_timestamp',
    'version', 'base_version', 'is_published', 'knowledge_base_ids', 'agent_name',
    'language', 'boosted_keywords']);
  const agentBase = Object.fromEntries(
    Object.entries(a.json).filter(([k]) => !agentSkip.has(k)));

  return {
    src: { agent: a.json, llm: l.json },
    patchedTools: patched,
    prompt,
    tools,
    llmBody: {
      model: l.json.model,
      model_temperature: l.json.model_temperature,
      model_high_priority: l.json.model_high_priority,
      general_prompt: prompt,
      general_tools: tools,
      begin_message: BEGIN,
      start_speaker: l.json.start_speaker,
      kb_config: KB_CONFIG,
    },
    agentBody: {
      ...agentBase,
      agent_name: AGENT_NAME,
      language: LANGUAGES,
      boosted_keywords: [...a.json.boosted_keywords,
        ...ZH_KEYWORDS.slice(0, Math.max(0, KEYWORD_CAP - a.json.boosted_keywords.length))],
    },
  };
}

if (mode === '--dry') {
  const b = await build();
  console.log(`source agent   ${SRC_AGENT}  "${b.src.agent.agent_name}"`);
  console.log(`source llm     ${b.src.llm.llm_id}  ${b.src.llm.model} @ temp ${b.src.llm.model_temperature}`);
  console.log('');
  console.log(`agent_name     ${b.agentBody.agent_name}`);
  console.log(`language       ${JSON.stringify(b.agentBody.language)}   (was ${JSON.stringify(b.src.agent.language)})`);
  console.log(`voice_id       ${b.agentBody.voice_id}  speed ${b.agentBody.voice_speed}`);
  console.log(`stt            ${b.agentBody.custom_stt_config?.provider}`);
  console.log(`begin_message  ${b.llmBody.begin_message}`);
  console.log(`prompt         ${b.prompt.length} chars (source ${b.src.llm.general_prompt.length})`);
  console.log(`tools          ${b.tools.length}, ${b.patchedTools} execution messages given a Chinese branch`);
  console.log(`kb_config      ${JSON.stringify(b.llmBody.kb_config)}  (source ${JSON.stringify(b.src.llm.kb_config)})`);
  console.log(`boosted kw     ${b.agentBody.boosted_keywords.length} (+${ZH_KEYWORDS.length} Chinese)`);
  console.log(`kb docs        ${fs.readdirSync(path.join(DIR, 'kb')).filter((f) => f.endsWith('.txt')).join(', ')}`);
  console.log('\n--dry: nothing sent. Run --apply to create it.');
  process.exit(0);
}

if (mode === '--apply') {
  const b = await build();

  // Resumable: a run that failed at the agent step must not orphan a second
  // knowledge base and LLM in the org. Reuse whatever deployed_ds30.json holds.
  const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

  let kbId = prev.knowledge_base_id;
  if (kbId) {
    console.log(`  -- knowledge base  ${kbId}  (reused from ${path.basename(STATE)})`);
  } else {
    const kbDir = path.join(DIR, 'kb');
    const docs = fs.readdirSync(kbDir).filter((f) => f.endsWith('.txt')).sort();
    if (!docs.length) die('no kb/*.txt documents');
    const form = new FormData();
    form.append('knowledge_base_name', KB_NAME);
    for (const f of docs) {
      form.append('knowledge_base_files',
        new Blob([fs.readFileSync(path.join(kbDir, f))], { type: 'text/plain' }), f);
    }
    const kr = await fetch(`${API}/create-knowledge-base`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
    const kj = await kr.json().catch(() => ({}));
    if (!ok(kr.status)) die(`knowledge base: ${kr.status} ${JSON.stringify(kj).slice(0, 300)}`);
    kbId = kj.knowledge_base_id;
    console.log(`  ok knowledge base  ${kbId}  (${docs.length} docs)`);
  }

  let llmId = prev.llm_id;
  if (llmId) {
    const up = await rt(`update-retell-llm/${llmId}`,
      { ...b.llmBody, knowledge_base_ids: [kbId] }, 'PATCH');
    if (!ok(up.status)) die(`llm patch: ${up.status} ${JSON.stringify(up.json).slice(0, 400)}`);
    console.log(`  ok llm             ${llmId}  (reused, config re-sent)`);
  } else {
    const lr = await rt('create-retell-llm', { ...b.llmBody, knowledge_base_ids: [kbId] });
    if (!ok(lr.status)) die(`llm: ${lr.status} ${JSON.stringify(lr.json).slice(0, 400)}`);
    llmId = lr.json.llm_id;
    console.log(`  ok llm             ${llmId}`);
  }

  const ar = await rt('create-agent', {
    ...b.agentBody,
    response_engine: { type: 'retell-llm', llm_id: llmId },
  });
  if (!ok(ar.status)) die(`agent: ${ar.status} ${JSON.stringify(ar.json).slice(0, 500)}`);
  console.log(`  ok agent           ${ar.json.agent_id}`);

  fs.writeFileSync(STATE, JSON.stringify({
    key_tail: KEY.slice(-6),
    knowledge_base_id: kbId,
    llm_id: llmId,
    agent_id: ar.json.agent_id,
    language: ar.json.language,
    deployed_at: new Date().toISOString(),
  }, null, 1));
  console.log(`\nids -> ${path.basename(STATE)}`);
}

if (mode === '--verify') {
  if (!fs.existsSync(STATE)) die('no deployed_ds30.json — run --apply first');
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const b = await build();
  const a = await rt(`get-agent/${st.agent_id}`);
  const l = await rt(`get-retell-llm/${st.llm_id}`);
  if (!ok(a.status) || !ok(l.status)) die(`read back failed: agent ${a.status} llm ${l.status}`);

  const norm = (v) => JSON.stringify(v, Object.keys(v || {}).sort ? undefined : undefined);
  const checks = [
    ['agent_name', a.json.agent_name, AGENT_NAME],
    ['language', JSON.stringify(a.json.language), JSON.stringify(LANGUAGES)],
    ['voice_id', a.json.voice_id, b.agentBody.voice_id],
    ['voice_speed', a.json.voice_speed, b.agentBody.voice_speed],
    ['stt provider', a.json.custom_stt_config?.provider, b.agentBody.custom_stt_config?.provider],
    ['model', l.json.model, b.llmBody.model],
    ['temperature', l.json.model_temperature, b.llmBody.model_temperature],
    ['high_priority', l.json.model_high_priority, b.llmBody.model_high_priority],
    ['begin_message', l.json.begin_message, BEGIN],
    ['prompt chars', l.json.general_prompt?.length, b.prompt.length],
    ['tool count', l.json.general_tools?.length, b.tools.length],
    ['kb ids', JSON.stringify(l.json.knowledge_base_ids), JSON.stringify([st.knowledge_base_id])],
    ['kb top_k', l.json.kb_config?.top_k, KB_CONFIG.top_k],
    ['kb filter_score', l.json.kb_config?.filter_score, KB_CONFIG.filter_score],
    ['no Bayton in prompt', /Bayton/i.test(l.json.general_prompt || '') ? 'FOUND' : 'clean', 'clean'],
  ];
  let bad = 0;
  for (const [name, got, want] of checks) {
    const good = String(got) === String(want);
    if (!good) bad++;
    console.log(`  ${good ? 'ok  ' : 'DIFF'} ${name.padEnd(22)} ${got}${good ? '' : `   (expected ${want})`}`);
  }
  const kb = await rt(`get-knowledge-base/${st.knowledge_base_id}`);
  console.log(`  ${kb.json.status === 'complete' ? 'ok  ' : 'DIFF'} kb status              ${kb.json.status}, ${kb.json.knowledge_base_sources?.length} docs`);
  console.log(`\n${checks.length - bad}/${checks.length} fields match`);
  if (bad) process.exit(1);
}
