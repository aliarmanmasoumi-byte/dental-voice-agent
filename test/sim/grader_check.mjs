// Which grader model can actually be trusted? Re-grade transcripts whose verdict
// I have already checked by hand, and see which model agrees with the truth.
import fs from 'node:fs';

const OPENAI = process.env.OPENAI_API_KEY;
const cases = (await import('./cases.mjs')).default;
const rows = fs.readFileSync('./resume_cases.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// hand-checked truth: I read these transcripts myself above
const TRUTH = { A01: true, A02: true, A06: true, A07: true, A08: true };

const chat = async (messages, model) => {
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0 }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (i + 1))); continue; }
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.choices[0].message.content;
  }
  throw new Error('rate limited');
};

const SYS = 'You grade a simulated phone call against success criteria. Judge ONLY what the transcript shows, and be precise: a value the CALLER said is not "introduced by the agent". Reply with JSON {"pass": true|false, "why": "<one sentence>"} and nothing else.';

const models = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'];
console.log('case  truth   ' + models.map((m) => m.padEnd(14)).join(''));
console.log('-'.repeat(60));

const score = Object.fromEntries(models.map((m) => [m, 0]));
let n = 0;
for (const [key, truth] of Object.entries(TRUTH)) {
  const row = rows.find((r) => r.name.startsWith(key));
  const c = cases.find((x) => x.name.startsWith(key));
  if (!row || !c) continue;
  n++;
  const convo = row.transcript.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n');
  const user = `SUCCESS CRITERIA:\n${c.metrics.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nTRANSCRIPT:\n${convo}`;
  const out = [];
  for (const m of models) {
    let v = null;
    try { v = JSON.parse((await chat([{ role: 'system', content: SYS }, { role: 'user', content: user }], m)).replace(/^```json\s*|\s*```$/g, '')); } catch {}
    const agrees = v && !!v.pass === truth;
    if (agrees) score[m]++;
    out.push(`${v ? (v.pass ? 'pass' : 'fail') : '?'}${agrees ? ' ok ' : ' X  '}`.padEnd(14));
  }
  console.log(`${key}  ${String(truth).padEnd(7)} ${out.join('')}`);
}
console.log('-'.repeat(60));
console.log('agreement with hand-checked truth:');
for (const m of models) console.log(`  ${m.padEnd(14)} ${score[m]}/${n}`);
