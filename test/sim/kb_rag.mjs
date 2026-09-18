// Mirror the platform's RAG so KB questions are tested the way production
// answers them: same embedding model, same ~900-char chunking, same top-3.
// (backend/lib/embeddings.js + voice/pipeline.js)
import fs from 'node:fs';

const KB_DIR = process.env.KB_DIR || new URL('../../agent/knowledge-base/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function chunkText(text, maxLen = 900) {
  const out = [];
  for (const para of String(text).split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxLen) { out.push(p); continue; }
    let buf = '';
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if ((buf + ' ' + s).trim().length > maxLen) { if (buf.trim()) out.push(buf.trim()); buf = s; }
      else buf = (buf + ' ' + s).trim();
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

export const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export const embed = async (texts, apiKey) => {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.data.map((d) => d.embedding);
};

// Build the index once per run.
export async function buildIndex(apiKey) {
  const chunks = [];
  for (const f of fs.readdirSync(KB_DIR).filter((x) => x.endsWith('.txt'))) {
    for (const c of chunkText(fs.readFileSync(`${KB_DIR}/${f}`, 'utf8'))) chunks.push(c);
  }
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 64) vectors.push(...await embed(chunks.slice(i, i + 64), apiKey));
  return chunks.map((chunk, i) => ({ chunk, embedding: vectors[i] }));
}

export async function topChunks(index, query, apiKey, k = 3) {
  const [qv] = await embed([query], apiKey);
  return index.map((c) => ({ chunk: c.chunk, score: cosine(qv, c.embedding) }))
    .sort((a, b) => b.score - a.score).slice(0, k).map((t) => t.chunk);
}
