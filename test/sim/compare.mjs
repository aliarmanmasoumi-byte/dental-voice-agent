// Fair comparison of the two architectures: count only real spoken turns
// (agent + user), excluding tool entries and the flow's NODE_TRANSITION rows,
// which the single-prompt transcripts do not have.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const isSpeech = (m) => m.role === 'agent' || m.role === 'assistant' || m.role === 'user';

const stat = (file, label) => {
  if (!fs.existsSync(path.join(DIR, file))) return null;
  const j = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const runs = j.runs || [];
  let speech = 0, agent = 0, tools = 0, transitions = 0, greetEs = 0, greetEn = 0;
  for (const r of runs) {
    const t = r.transcript_snapshot?.transcript || [];
    for (const m of t) {
      if (m.role === 'tool_call_invocation') tools++;
      else if (String(m.role).includes('node')) transitions++;
      else if (isSpeech(m)) { speech++; if (m.role !== 'user') agent++; }
    }
    const first = t.find((m) => m.role === 'agent' || m.role === 'assistant');
    if (first) (/¿|soy Laura|puedo ayudarle/i.test(String(first.content)) ? greetEs++ : greetEn++);
  }
  return { label, runs: runs.length, speech, agent, tools, transitions, greetEs, greetEn,
    speechPerConv: runs.length ? (speech / runs.length).toFixed(1) : '-',
    toolsPerConv: runs.length ? (tools / runs.length).toFixed(1) : '-' };
};

const rows = [
  stat('flow_cases.json', 'flow  suite1'),
  stat('flow_cases2.json', 'flow  suite2'),
];
// most recent single-prompt reports, by suite
const reps = fs.readdirSync(DIR).filter((f) => /^report_.*\.json$/.test(f)).sort();
for (const suite of ['single suite1', 'single suite2']) {
  const wantNew = suite.endsWith('2');
  for (let i = reps.length - 1; i >= 0; i--) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, reps[i]), 'utf8'));
    if (!j.runs || j.runs.length < 60) continue;
    const isNew = Object.values(j.names).some((n) => /^[NOPQRSTU]\d\d /.test(n));
    if (isNew !== wantNew) continue;
    const s = stat(reps[i], suite); if (s) rows.push(s); break;
  }
}

console.log('architecture     conv   spoken turns   per conv   tool calls   per conv   greeting ES/EN');
console.log('-'.repeat(92));
for (const r of rows.filter(Boolean)) {
  console.log(`${r.label.padEnd(16)}${String(r.runs).padStart(5)}${String(r.speech).padStart(15)}${String(r.speechPerConv).padStart(11)}${String(r.tools).padStart(13)}${String(r.toolsPerConv).padStart(11)}${String(r.greetEs + '/' + r.greetEn).padStart(17)}`);
}
console.log('\nnode transitions logged by the flow runs:', rows.filter(Boolean).filter((r) => r.label.startsWith('flow')).reduce((s, r) => s + r.transitions, 0));
