// Which advanced tool types does the API actually accept on a retell-llm agent?
// Creating LLMs is free; only running tests costs credit.
import { api } from './test/sim/config.mjs';

const candidates = [
  { type: 'send_sms', name: 'send_sms', description: 'Text the caller.' },
  { type: 'agent_swap', name: 'agent_swap', description: 'Hand the call to another agent.', agent_id: 'agent_bf61933a93a3954e123063f231' },
  { type: 'press_digit', name: 'press_digit', description: 'Press a keypad digit.' },
  { type: 'extract_dynamic_variable', name: 'extract_details', description: 'Capture caller details.', variables: [{ name: 'patient_name', type: 'string', description: 'The full name of the person on the phone, first and last.' }] },
  { type: 'code', name: 'validate_slot', description: 'Validate a slot.', code: 'return { ok: true };' },
  { type: 'mcp', name: 'mcp', description: 'MCP.', url: 'https://example.com/mcp' },
];

for (const t of candidates) {
  const r = await api('create-retell-llm', {
    model: 'gpt-4.1', general_prompt: 'probe', general_tools: [t],
  });
  const ok = r.status < 300;
  console.log(`${String(t.type).padEnd(26)} ${ok ? 'ACCEPTED' : 'rejected'}  ${ok ? '' : String(JSON.stringify(r.json)).slice(0, 150)}`);
  if (ok) await api(`delete-retell-llm/${r.json.llm_id}`, null, 'DELETE');
}
