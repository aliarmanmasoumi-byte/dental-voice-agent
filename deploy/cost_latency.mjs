// What do the dashboards actually hold for cost and latency on each account?
import fs from 'node:fs';

// two accounts, so the same agent can be priced on both
const OLD = process.env.RETELL_KEY_OLD;
const NEW = process.env.RETELL_KEY;

const calls = async (key, label) => {
  const r = await fetch('https://api.retellai.com/v2/list-calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 20, sort_order: 'descending' }),
  });
  if (!r.ok) { console.log(`${label}: HTTP ${r.status}`); return []; }
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (j.calls || []);
  console.log(`\n=== ${label}: ${arr.length} calls ===`);
  if (!arr.length) return [];
  console.log('when                  secs  cost¢   ¢/min   e2e p50  llm p50  asr p50  model');
  for (const c of arr) {
    const s = c.call_cost?.total_duration_seconds ?? Math.round((c.duration_ms || 0) / 1000);
    const cost = c.call_cost?.combined_cost;
    const perMin = cost && s ? (cost / (s / 60)).toFixed(1) : '-';
    const llmProd = (c.call_cost?.product_costs || []).find((p) => /gpt|claude|gemini/.test(p.product));
    console.log(
      `${new Date(c.start_timestamp).toISOString().slice(0, 16).replace('T', ' ')}  ${String(s).padStart(4)}  ${String(cost?.toFixed(1) ?? '-').padStart(5)}  ${String(perMin).padStart(6)}  ` +
      `${String(Math.round(c.latency?.e2e?.p50 ?? 0) || '-').padStart(7)}  ${String(Math.round(c.latency?.llm?.p50 ?? 0) || '-').padStart(7)}  ${String(Math.round(c.latency?.asr?.p50 ?? 0) || '-').padStart(7)}  ${llmProd?.product || '-'}`
    );
  }
  return arr;
};

await calls(OLD, 'ORIGINAL ACCOUNT (has the phone number)');
await calls(NEW, 'SECOND ACCOUNT (migrated agent)');
