import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.RETELL_KEY;
const ids = JSON.parse(fs.readFileSync(process.env.RETELL_DEPLOYED || path.join(DIR, 'deployed.json'), 'utf8'));
const get = async (p) => (await fetch(`https://api.retellai.com/${p}`, { headers: { Authorization: `Bearer ${KEY}` } })).json();

const llm = await get(`get-retell-llm/${ids.llm_id}`);
console.log('TOOLS');
for (const t of llm.general_tools) {
  const host = t.url ? new URL(t.url).host : '-';
  console.log(`  ${String(t.name).padEnd(14)} ${String(t.type).padEnd(9)} ${host.padEnd(24)} exec_msg:${t.execution_message_description ? 'yes' : 'no '} speak:${t.speak_during_execution}`);
}
const parroted = llm.general_tools.filter((t) => /e\.g\.|'[A-Z][a-z]/.test(t.execution_message_description || ''));
console.log(`  tools carrying a quotable example: ${parroted.length}`);

console.log('\nPARAMETER GUARDS (the three that only worked at tool level)');
for (const t of llm.general_tools) {
  for (const f of ['service', 'phone', 'name']) {
    const d = t.parameters?.properties?.[f]?.description;
    if (!d) continue;
    const ok = { service: /must be an actual treatment/, phone: /No read-back|read the number back/i, name: /must LOOK like a name|look like a name/ }[f].test(d);
    console.log(`  ${String(t.name).padEnd(14)} ${f.padEnd(8)} ${ok ? 'guard present' : 'GUARD MISSING'}`);
  }
}

const kb = await get(`get-knowledge-base/${ids.knowledge_base_id}`);
console.log(`\nKNOWLEDGE BASE  ${kb.knowledge_base_name}  status=${kb.status}  sources=${(kb.knowledge_base_sources || []).length}`);
for (const s of kb.knowledge_base_sources || []) console.log(`  ${s.type} ${s.filename || s.title || ''}`);

const agent = await get(`get-agent/${ids.agent_id}`);
console.log(`\nAGENT ${agent.agent_id}  ${agent.agent_name}`);
console.log(`  engine ${agent.response_engine?.llm_id === ids.llm_id ? '-> correct llm' : 'WRONG LLM'}`);

const nums = await get('list-phone-numbers');
console.log(`\nPHONE NUMBERS in the new workspace: ${Array.isArray(nums) ? nums.length : JSON.stringify(nums).slice(0, 80)}`);
