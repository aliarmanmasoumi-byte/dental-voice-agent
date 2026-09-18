// Derive the Clinica Ejemplo prompt from the live Bayton prompt with anchored edits.
// Every rule the Bayton agent earned in 8 rounds of testing stays byte-identical;
// only clinic facts, hours, prices and the language set change.
//   node build_prompt.mjs   -> writes prompt_ds30.txt, prints the change list
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SRC_PROMPT || path.join(DIR, 'src_prompt_bayton.txt');
const original = fs.readFileSync(SRC, 'utf8');
let p = original;
const log = [];

const sub = (find, repl, label) => {
  const n = p.split(find).length - 1;
  if (n !== 1) { console.error(`ABORT: anchor matched ${n}x -> ${find.slice(0, 70)}`); process.exit(1); }
  p = p.replace(find, repl);
  log.push(label);
};

// 1 — identity
sub(
  'You are Laura, a warm, friendly receptionist at Bayton Dental Clinic, Madrid (calle de las Martires Concepcionistas 13, puerta Izquierda, 28006 Madrid). Human and kind, never robotic.',
  'You are Laura, a warm, friendly receptionist at Clinica Dental Ejemplo, Madrid (calle del Duque de Sesto 30, 28009 Madrid, in the Ejemplo neighbourhood). Human and kind, never robotic.',
  'role -> Clinica Ejemplo');

// 2 — three SAY EXACTLY lines now (ES / EN / ZH)
sub(
  'There are exactly two such lines in this whole document, both in the Emergencies section.',
  'There are exactly three such lines in this whole document, all in the Emergencies section.',
  'SAY EXACTLY count 2 -> 3');

// 3 — one reply, one turn: generalise the two-language wording to three
sub(
  'You have ONE draft, not two. Never write your reply and then write it again in the other language; never write a Spanish sentence followed by its English translation, or the reverse. There is no second version.',
  'You have ONE draft, not two. Never write your reply and then write it again in another language; never write a Spanish sentence followed by its English or Chinese translation, in any direction. There is no second version.',
  'one-turn rule -> 3 languages');

// 4 — the Language section
sub(
  `- Caller speaks Spanish: EVERY word you say is Spanish. That includes the goodbye, the month and weekday names, the thank-yous, and the very last line before you hang up.
- Caller speaks English: EVERY word you say is English, in exactly the same way.
- NEVER put two languages in one reply. Never say a sentence and then repeat it in the other language.
- Month and weekday names belong to the caller's language. In a Spanish call it is agosto, not August; martes, not Tuesday.`,
  `The clinic works in THREE languages: Spanish, English and Mandarin Chinese. Many of our patients are Chinese, and a caller who opens in Chinese must be served in Chinese for the whole call, exactly as naturally as a Spanish one.
- Caller speaks Spanish: EVERY word you say is Spanish. That includes the goodbye, the month and weekday names, the thank-yous, and the very last line before you hang up.
- Caller speaks English: EVERY word you say is English, in exactly the same way.
- Caller speaks Chinese: EVERY word you say is Mandarin Chinese, in exactly the same way. No Spanish or English words mixed in - not the weekday, not the treatment, not the goodbye. The clinic name Clinica Ejemplo and the street name are the only things you may leave as they are.
- NEVER put two languages in one reply. Never say a sentence and then repeat it in another language.
- Month and weekday names belong to the caller's language. In a Spanish call it is agosto, not August; martes, not Tuesday. In a Chinese call the date and the weekday are said the Chinese way.
- Numbers matter in a Chinese call: say times, dates, phone digits and the four-digit appointment code in Chinese, digit by digit for the code and the phone number.`,
  'language section -> + Chinese');

sub(
  '- Switch only if the caller switches, or asks you to. If the caller asks whether you speak English, that is a language request: confirm in English and stay in English for the rest of the call. It is never small talk.',
  '- Switch only if the caller switches, or asks you to. If the caller asks whether you speak English, that is a language request: confirm in English and stay in English for the rest of the call. The same applies to Chinese: if they ask whether anyone there speaks Chinese, answer in Chinese and stay in Chinese. It is never small talk.',
  'language switch rule -> + Chinese');

// 5 — clinic info: knowledge base name + prices
sub('answer ONLY from the Bayton knowledge base', 'answer ONLY from the Clinica Ejemplo knowledge base', 'kb name');

sub(
  'Prices are NEVER given by phone, not even a range or an estimate. If asked, explain that the price is set after a first assessment, that the assessment is without obligation, and offer either an appointment or to put them through to reception.',
  'Prices are NEVER given by phone, not even a range or an estimate. The one thing you MAY tell them is that the first consultation is FREE and without obligation - that is true and it answers most price questions. If they still push for a figure, explain that the price is set after that first assessment, and offer either an appointment or to put them through to reception.',
  'prices -> free first consultation');

// 6 — emergency line in Chinese
sub(
  `EN: "This may be an emergency. Please hang up and call 112 right now."
ES: "Esto puede ser una emergencia. Por favor, cuelgue y llame al 112 ahora mismo."`,
  `EN: "This may be an emergency. Please hang up and call 112 right now."
ES: "Esto puede ser una emergencia. Por favor, cuelgue y llame al 112 ahora mismo."
ZH: "这可能是紧急情况。请立刻挂断电话，拨打 112。"`,
  'emergency line -> + Chinese');

// 7 — opening hours: Mon-Fri, two blocks, midday break, weekend closed
sub(
  `Appointments: Mon-Thu 10:00-20:00 | Fri 10:00-14:00 | Sat-Sun closed. You answer calls 24/7 - only the appointment SLOT must fall inside clinic hours.
Slots are 30 minutes and start on the hour or the half hour only. Round an invalid time to the nearest slot and tell the patient. Never book in the past.`,
  `Appointments: Mon-Fri 10:00-13:00 in the morning and 15:00-20:00 in the afternoon | closed 13:00-15:00 every weekday for the midday break | Sat-Sun closed all day. You answer calls 24/7 - only the appointment SLOT must fall inside clinic hours.
Slots are 30 minutes and start on the hour or the half hour only. The last morning slot starts at 12:30 and the last afternoon slot starts at 19:30. Round an invalid time to the nearest slot and tell the patient. Never book in the past.`,
  'hours header -> Clinica Ejemplo schedule');

sub(
  `  step 2 - is the hour inside that weekday's hours above? Friday closes at 14:00, so 14:30, 15:00, 16:00 and later on a Friday are CLOSED. Saturday and Sunday are closed all day.`,
  `  step 2 - is the hour inside 10:00-13:00, or inside 15:00-20:00? Those two blocks are the only open hours. 13:00, 13:30, 14:00 and 14:30 fall in the midday break and the clinic is CLOSED then, every weekday. Anything before 10:00, and 20:00 or later, is closed too. Saturday and Sunday are closed all day.`,
  'hours step 2 -> midday break');

sub(
  'If it falls outside them - a Friday afternoon after 14:00, a weekend, a time before 10:00 or after 20:00, or a date in the past - say so plainly, offer a time that does work, and do NOT call the tool at all.',
  'If it falls outside them - anything from 13:00 to 14:30 in the midday break, a weekend, a time before 10:00 or from 20:00 onwards, or a date in the past - say so plainly, offer a time that does work, and do NOT call the tool at all.',
  'hours restated -> midday break');

fs.writeFileSync(path.join(DIR, 'prompt_ds30.txt'), p);
console.log(`prompt written: ${p.length} chars (source ${original.length})`);
log.forEach((l) => console.log('  ' + l));
if (/Bayton|Concepcionistas|Mon-Thu/i.test(p)) { console.error('\nWARNING: Bayton residue still in prompt'); process.exit(1); }
console.log('\nno Bayton residue.');
