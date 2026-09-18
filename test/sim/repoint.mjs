// Repoint every harness script at the new workspace via config.mjs.
// Deliberately does NOT import the scripts to check them — importing would
// execute them and spend credit. Syntax-check with `node --check` instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = ['run.mjs', 'promptab.mjs', 'finals.mjs', 'sweep.mjs', 'ab.mjs', 'poll.mjs'];
const OLD_LLM = 'llm_75b4d09ba4f7c516b5485f42f6df';

for (const f of files) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { console.log(`  -- ${f} (absent)`); continue; }
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  s = s.replace(/^const KEY = fs\.readFileSync\([^\n]*\n/m, '');
  s = s.replace(/^const API = 'https:\/\/api\.retellai\.com';\n/m, '');
  s = s.replace(new RegExp(`^const (?:LLM_ID|PROD|PROD_LLM) = '${OLD_LLM}';\\n`, 'm'), '');
  s = s.split(`'${OLD_LLM}'`).join('LLM_ID');
  s = s.replace(/\bPROD_LLM\b/g, 'LLM_ID');

  if (!s.includes("from './config.mjs'")) {
    const anchor = s.match(/^import .*from 'node:url';\n/m) || s.match(/^import [^\n]*\n/m);
    if (anchor) s = s.replace(anchor[0], anchor[0] + `import { KEY, API, LLM_ID, guardBilling } from './config.mjs';\n`);
  }

  fs.writeFileSync(p, s);
  console.log(`  ${s !== before ? 'ok' : '--'} ${f}`);
}
console.log('\nsyntax-check each with: node --check <file>');
