// Count every simulated conversation actually run, from the artifacts on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const f = fs.readdirSync(DIR);
const rows = [];
let convs = 0, turns = 0, agentMsgs = 0, toolCalls = 0;

const tally = (file, label) => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const runs = j.runs || [];
  let t = 0, a = 0, tc = 0;
  for (const r of runs) {
    for (const m of r.transcript_snapshot?.transcript || []) {
      t++;
      if (m.role === 'agent' || m.role === 'assistant') a++;
      if (m.role === 'tool_call_invocation') tc++;
    }
  }
  convs += runs.length; turns += t; agentMsgs += a; toolCalls += tc;
  rows.push({ label, file, runs: runs.length, turns: t, agent: a, tools: tc });
};

for (const x of f.filter((x) => /^report_.*\.json$/.test(x)).sort()) tally(x, 'suite round');
for (const x of f.filter((x) => /^final_.*\.json$/.test(x)).sort()) tally(x, 'model finals');
for (const x of f.filter((x) => /^ab_.*\.json$/.test(x)).sort()) tally(x, 'single A/B');

// the sweep deleted its clones but kept the counts
let sweepRuns = 0;
if (f.includes('sweep_results.json')) {
  for (const r of JSON.parse(fs.readFileSync(path.join(DIR, 'sweep_results.json'), 'utf8'))) {
    sweepRuns += r.total || 0; agentMsgs += r.msgs || 0;
  }
}

const byLabel = {};
for (const r of rows) {
  byLabel[r.label] = byLabel[r.label] || { files: 0, runs: 0, turns: 0, agent: 0, tools: 0 };
  const b = byLabel[r.label];
  b.files++; b.runs += r.runs; b.turns += r.turns; b.agent += r.agent; b.tools += r.tools;
}

console.log('what is recorded on disk\n');
console.log('group                 files   conversations   turns   agent msgs   tool calls');
console.log('-'.repeat(78));
for (const [k, b] of Object.entries(byLabel)) {
  console.log(`${k.padEnd(20)}${String(b.files).padStart(6)}${String(b.runs).padStart(16)}${String(b.turns).padStart(8)}${String(b.agent).padStart(13)}${String(b.tools).padStart(13)}`);
}
console.log(`${'19-model sweep'.padEnd(20)}${'-'.padStart(6)}${String(sweepRuns).padStart(16)}${'-'.padStart(8)}${'(counted)'.padStart(13)}${'-'.padStart(13)}`);
console.log('-'.repeat(78));
console.log(`${'TOTAL'.padEnd(20)}${String(rows.length).padStart(6)}${String(convs + sweepRuns).padStart(16)}${String(turns).padStart(8)}${String(agentMsgs).padStart(13)}${String(toolCalls).padStart(13)}`);
console.log('\nnote: turns/agent-msgs/tool-calls exclude the sweep, whose per-run transcripts were not saved.');
