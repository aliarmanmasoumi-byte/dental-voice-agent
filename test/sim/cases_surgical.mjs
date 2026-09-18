// Surgical suite, 2026-09-04. Written to verify exactly two fixes and guard the flows they
// touch — not to produce a score. I grade these from the transcripts myself; the `metrics`
// below exist only because the API demands one, and their verdicts are ignored.
//
// Rules applied from what went wrong before:
//   - every caller gets an explicit exit, so the simulator's loop guard never fires
//   - mocks agree with the frozen anchor: today = Thursday 2026-08-27
//   - where a fix is about confirmed_time, the mock deliberately returns a DIFFERENT time
const M = (tool_name, output, rule = { type: 'any' }) => ({ tool_name, input_match_rule: rule, output: typeof output === 'string' ? output : JSON.stringify(output) });
const NOW = { local_time: '2026-08-27T12:00:00', timezone: 'Europe/Madrid' };
const OK = { status: 'success', is_available: true };
const NO = { status: 'success', is_available: false };
const SLOTS = (a, b) => ({ suggested_slots: [{ start: a }, { start: b }], message: 'Week search completed.' });
const SPOKEN = (t) => { const d=new Date(t); const W=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'], M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return { date_spoken: W[d.getUTCDay()]+' '+d.getUTCDate()+' de '+M[d.getUTCMonth()], time: t.slice(11,16) }; };
const BOOKED = (code, time) => ({ status: 'success', message: 'Appointment booked successfully.', appointment_id: code, confirmed_time: time, ...SPOKEN(time) });
const CANCELLED = { status: 'success', message: 'Appointment canceled successfully.' };
const RESCHED = (t) => ({ status: 'success', message: 'Appointment rescheduled successfully', confirmed_time: t, ...SPOKEN(t) });
const LOOKUP = { status: 'success', count: 1, next: { when: '2026-08-31T16:00:00+02:00', date_spoken: 'lunes 31 de agosto', time: '16:00', appointment_code: '3097', service: 'revisión dental' }, appointments: [{ when: '2026-08-31T16:00:00+02:00' }], message: 'Upcoming appointments found.' };
const CAL_ERR = { status: 'error', error: 'CALENDAR_ERROR', message: 'Technical issue with the booking system. Please transfer to reception.' };
const ERR = (m, d) => (d ? { status: 'error', message: m, detail: d } : { status: 'error', message: m });
const base = (over = {}) => Object.entries({ time: NOW, availability: OK, suggesting: SLOTS('2026-08-31T10:00:00+02:00', '2026-08-31T10:30:00+02:00'), suggesting2: SLOTS('2026-08-31T10:00:00+02:00', '2026-08-31T10:30:00+02:00'), appointment: BOOKED('4821', '2026-08-31T10:00:00+02:00'), canceling: CANCELLED, reschedule: RESCHED('2026-09-02T17:00:00+02:00'), consulting: LOOKUP, waitlist_add: { status: 'success', message: 'Added.' }, ...over }).map(([k, v]) => M(k, v));
const EXIT = ' Once they confirm, thank them and say goodbye.';
const C = (name, user_prompt, tool_mocks) => ({ name, user_prompt, metrics: ['The agent stayed on task.'], tool_mocks: tool_mocks || base() });

const MAIN=[
  // --- FIX A: confirmed_time differs from what was asked ---
  C('X01 confirmed_time differs on booking',
    'Eres Marta Gil. Pides cita para una limpieza el lunes a las diez de la manana. Telefono 611222333.' + EXIT,
    base({ appointment: BOOKED('4821', '2026-08-31T10:30:00+02:00') })),
  C('X02 confirmed_time differs on reschedule',
    'You are Peter Vance. You want to move your appointment to Wednesday at five in the afternoon. Your name is Peter Vance.' + EXIT,
    base({ reschedule: RESCHED('2026-09-02T18:00:00+02:00') })),
  C('X03 confirmed_time matches the request',
    'Eres Ana Ruiz. Pides cita para una revision el lunes a las diez de la manana. Telefono 622333444.' + EXIT),

  // --- FIX B: must not book a slot no tool confirmed as free ---
  C('X04 asks for a vague morning slot',
    'Eres Luis Marin. Quieres cita para una limpieza el lunes por la manana, sin hora concreta. Telefono 633444555. Aceptas la primera hora que te ofrezcan.' + EXIT),
  C('X05 requested slot is taken',
    'Eres Rosa Diaz. Pides cita el lunes a las diez de la manana para una revision. Telefono 644555666. Si no esta libre, aceptas la alternativa que te ofrezcan.' + EXIT,
    base({ availability: NO })),

  // --- availability-only: must not collect personal details ---
  C('X06 only asks whether a time is free',
    'Eres Carmen Sanz. Solo quieres saber si el lunes a las diez de la manana hay hueco. NO quieres reservar todavia. Cuando te respondan, das las gracias y te despides.'),

  // --- date reasoning against the frozen anchor (today = Thu 2026-08-27) ---
  C('X07 tomorrow',
    'Eres Diego Mora. Pides cita para una limpieza manana a las once. Telefono 655666777. Aceptas lo que te ofrezcan.' + EXIT),
  C('X08 next monday',
    'You are Helen Barr. You want a check-up next Monday at ten in the morning. Your phone is 666777888. Accept whatever they offer.' + EXIT),

  // --- regression guards on the flows the fixes touch ---
  C('X09 lookup then cancel',
    'Eres Silvia Roca. Primero preguntas cuando es tu cita. Cuando te lo digan, pides cancelarla.' + EXIT),
  C('X10 cancel with code',
    'You are Ingrid Halvor. You want to cancel your appointment, code 3097, Monday afternoon.' + EXIT),
  C('X11 calendar error must transfer',
    'You are Tom Reed. You want to cancel your appointment, code 3097. If they say there is a technical problem, accept being put through and say goodbye.',
    base({ canceling: CAL_ERR })),
  C('X12 invalid slot must not transfer',
    'Eres Hugo Sanz. Pides cita el lunes a las diez y cuarto para una limpieza. Telefono 677888999. Si rechazan la hora, aceptas la alternativa.' + EXIT,
    [M('appointment', BOOKED('4821', '2026-08-31T10:30:00+02:00'), { type: 'partial_match', args: { booking_time: '2026-08-31T10:30:00' } }),
     ...base({ appointment: ERR('INVALID_SLOT', 'Appointments are only on the hour or half hour.') })]),
];

// X13/X14 — hypothesis test, 2026-09-04. Two prompt attempts failed to make the agent read
// confirmed_time when the gap was only 30 minutes. But `consulting` already returns a
// PRE-FORMATTED date_spoken and the agent reads that flawlessly every time. So the defect may
// be the RESULT SHAPE, not the prompt: an ISO timestamp has to be parsed and converted, a
// spoken string only has to be echoed. Same scenario as X01, only the mock's shape differs.
const EXTRA=[
  { name: 'X13 confirmed differs, result carries date_spoken',
    user_prompt: 'Eres Marta Gil. Pides cita para una limpieza el lunes a las diez de la manana. Telefono 611222333. Una vez confirmada, das las gracias y te despides.',
    metrics: ['The agent stayed on task.'],
    tool_mocks: [
      { tool_name: 'availability', input_match_rule: { type: 'any' }, output: JSON.stringify({ status: 'success', is_available: true }) },
      { tool_name: 'appointment', input_match_rule: { type: 'any' }, output: JSON.stringify({ status: 'success', message: 'Appointment booked successfully.', appointment_id: '4821', confirmed_time: '2026-08-31T10:30:00+02:00', date_spoken: 'lunes 31 de agosto', time: '10:30' }) },
      { tool_name: 'end_call', input_match_rule: { type: 'any' }, output: '{}' },
    ] },
];

export default [...MAIN,...EXTRA];
