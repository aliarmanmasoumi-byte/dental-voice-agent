// Single source of truth for which account and agent the harness talks to.
//
//   RETELL_KEY=key_…  RETELL_LLM_ID=llm_…  RETELL_AGENT_ID=agent_…  node run.mjs
//
// Alternatively point RETELL_DEPLOYED at the deployed.json that deploy/deploy.mjs
// writes, and the ids are read from there.
import fs from 'node:fs';

const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ids = (process.env.RETELL_DEPLOYED ? read(process.env.RETELL_DEPLOYED) : null) || {};

export const KEY = process.env.RETELL_KEY;
if (!KEY) {
  console.error('set RETELL_KEY (and RETELL_LLM_ID / RETELL_AGENT_ID, or RETELL_DEPLOYED)');
  process.exit(2);
}

// Hard-won: a round once ran against a *different* org than the one holding the agent.
// Every definition 404'd with "not found in retell-stateful-llm-version", and that other
// org then returned 402 "Payment overdue" — which reads exactly like your own account
// dying. If the deployment recorded which key it used, refuse to run against another one.
if (ids.key_tail && !KEY.endsWith(ids.key_tail)) {
  console.error(
    `\n*** WRONG ACCOUNT: the recorded deployment holds agent ${ids.agent_id} on the org\n` +
    `    whose key ends "${ids.key_tail}", but RETELL_KEY ends "${KEY.slice(-6)}".\n`
  );
  process.exit(2);
}

export const API = 'https://api.retellai.com';

export const LLM_ID = process.env.RETELL_LLM_ID || ids.llm_id;
export const AGENT_ID = process.env.RETELL_AGENT_ID || ids.agent_id;
export const KB_ID = process.env.RETELL_KB_ID || ids.knowledge_base_id;

export const api = async (p, body, method = 'POST', key = KEY) => {
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
};

// Stop early and loudly if the wallet runs dry mid-run rather than burning
// calls that will all fail the same way.
export const guardBilling = (res, where) => {
  if (res.status === 402 || /payment|overdue|insufficient|credit/i.test(JSON.stringify(res.json || ''))) {
    console.error(`\n*** BILLING STOP at ${where}: ${JSON.stringify(res.json).slice(0, 200)}`);
    process.exit(2);
  }
};
