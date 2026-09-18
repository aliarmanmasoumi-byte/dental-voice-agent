// Bayton / Laura — simulation test matrix.
//
// Each case is a FULL patient conversation driven by a simulated caller LLM.
// Tools are mocked with the exact response shapes the real n8n backend returns
// (extracted from bayton_workflow_CURRENT.json), so nothing touches Google
// Calendar or WhatsApp, and error branches that the real backend almost never
// produces can be forced on demand.
//
// METRIC RULE (learned the hard way in the probe): one atomic assertion per
// metric. A compound metric ("X and only after Y") makes the grader fail runs
// that were actually correct.
//
// Calendar anchor: today is Thursday 2026-08-27.
//   Fri 2026-08-28 (clinic closes 14:00) | Sat 29 + Sun 30 closed | Mon 2026-08-31

const M = (tool_name, output, rule = { type: 'any' }) => ({
  tool_name,
  input_match_rule: rule,
  output: typeof output === 'string' ? output : JSON.stringify(output),
});

// ---- real backend response shapes -----------------------------------------
const OK_AVAIL = { status: 'success', is_available: true };
const NO_AVAIL = { status: 'success', is_available: false };
const SLOTS = (a, b) => ({ suggested_slots: [{ start: a }, { start: b }], message: 'Week search completed.' });
const SAMEDAY = (a, b) => ({ suggested_slots: [{ start: a }, { start: b }], message: 'Slots found in the same day.' });
const DAY_FULL = { suggested_slots: [], message: 'DAY_FULL' };
const BOOKED = (code, time) => ({ status: 'success', message: 'Appointment booked successfully.', appointment_id: code, confirmed_time: time });
const CANCELLED = { status: 'success', message: 'Appointment canceled successfully.' };
const RESCHEDULED = (time) => ({ status: 'success', message: 'Appointment rescheduled successfully', confirmed_time: time });
const ERR = (message, detail) => (detail ? { status: 'error', message, detail } : { status: 'error', message });
const AMBIG = ERR('AMBIGUOUS', 'Multiple appointments match this name. Ask the patient for their 4-digit appointment code or the exact appointment time, then retry.');
const CAL_ERR = { status: 'error', error: 'CALENDAR_ERROR', message: 'I am very sorry, there seems to be a technical issue with our booking system right now. Please transfer the call to the reception team.' };
const VALID_ERR = (code, msg) => ({ status: 'error', message: code, detail: msg });
const LOOKUP = (list) => ({ status: 'success', count: list.length, next: list[0], appointments: list, message: 'Upcoming appointments found.' });
const NOW = { local_time: '2026-08-27T12:00:00', timezone: 'Europe/Madrid' };

// Default mock set: everything succeeds. Cases override what they need.
const base = (over = {}) => {
  const d = {
    time: NOW,
    availability: OK_AVAIL,
    suggesting: SLOTS('2026-08-31T10:00:00+02:00', '2026-08-31T11:30:00+02:00'),
    suggesting2: SAMEDAY('2026-08-31T10:00:00+02:00', '2026-08-31T11:30:00+02:00'),
    appointment: BOOKED('4821', '2026-08-31T10:00:00+02:00'),
    canceling: CANCELLED,
    reschedule: RESCHEDULED('2026-09-01T16:00:00+02:00'),
    consulting: LOOKUP([{ when: '2026-09-01T16:00:00+02:00', date_spoken: 'martes 1 de septiembre', time: '16:00', appointment_code: '3097', service: 'revisión dental' }]),
    waitlist_add: { status: 'success', message: 'Added to the waiting list.' },
  };
  return Object.entries({ ...d, ...over }).map(([k, v]) => M(k, v));
};

// Metrics reused across many cases.
const NEVER_INVENT = 'The agent never introduced a patient name, phone number, service, date or time of its own. Values the caller said, and values that came back inside a tool result, are both fine to repeat.';
const SAME_TURN = 'Every time the agent told the caller it was checking, booking, moving, cancelling or looking something up, it actually invoked a tool — it never said it was doing something and then just waited for the caller.';
const NO_RAW = 'The agent never read a machine-formatted date or time aloud, such as a hyphenated date like 2026-08-31 or a timestamp with seconds.';
const ES_ONLY = 'Ignore the very first agent message, which is a fixed automatic greeting. Every agent message after it was entirely in Spanish, including the goodbye and any month or weekday names.';
const EN_ONLY = 'Ignore the very first agent message, which is a fixed automatic greeting in Spanish. Every agent message after it was entirely in English, including the goodbye.';
const NO_MIX = 'No single agent message mixed Spanish and English together.';
const NO_BRACKETS = 'The agent never spoke a placeholder in square brackets, a section heading, a field name, or punctuation read out as a word.';

const ENDS = 'The agent called the end_call tool once the caller had said goodbye or said they needed nothing else.';

const C = (name, user_prompt, metrics, mocks = base()) => ({ name, user_prompt, metrics, tool_mocks: mocks });

export const cases = [

  // ---------------------------------------------------------------- A. booking, happy
  C('A01 book ES limpieza monday morning',
    'Eres Carmen Delgado, paciente española de 41 años. Llamas para pedir cita de limpieza dental el lunes por la mañana. Tu teléfono es 612345678, lo tecleas si te lo piden. Hablas SOLO español. Responde breve y natural, una cosa cada vez. Cuando te den el código, das las gracias y te despides.',
    ['The agent booked the appointment by calling the appointment tool.', 'The agent read a 4-digit confirmation code back to the caller.', NEVER_INVENT, ES_ONLY, NO_RAW, ENDS]),

  C('A02 book EN checkup next week',
    'You are Michael Foster, a 35-year-old English-speaking patient. You want to book a dental check-up for next Monday at 11am. Your phone is 655112233 and you type it if asked. You speak ONLY English. Keep answers short and natural, one thing at a time. Thank them and say goodbye once you have the code.',
    ['The agent booked the appointment by calling the appointment tool.', 'The agent read a 4-digit confirmation code back to the caller.', EN_ONLY, NO_MIX, NEVER_INVENT],
    base({ appointment: BOOKED('4821', '2026-08-31T11:00:00+02:00') })),

  C('A03 book ES service not stated up front',
    'Eres Rosa Jimenez, española. Llamas y solo dices que quieres una cita el lunes a las diez, sin decir para qué tratamiento. Si te preguntan el servicio, di que es para un empaste. Tu teléfono es 611223344. Hablas SOLO español, respuestas cortas.',
    ['The agent asked the caller which service the appointment was for before booking.', 'The agent booked the appointment by calling the appointment tool.', NEVER_INVENT, ES_ONLY]),

  C('A04 book EN vague time then agrees to a slot',
    'You are Sarah Klein, English-speaking. You call and say you want an appointment "sometime next week, whenever there is space" for a cleaning. You have no strong preference. Accept the first reasonable slot the agent offers. Your phone is 677889900. Speak ONLY English, short answers.',
    ['The agent offered the caller specific times that came from a tool result rather than inventing times.', 'The agent booked the appointment by calling the appointment tool.', EN_ONLY, SAME_TURN]),

  C('A05 book ES caller asks price first then books',
    'Eres Antonio Ruiz, español. Primero preguntas cuánto cuesta una limpieza dental. Después de que te contesten, pides cita para el lunes a las once y media. Tu teléfono es 699001122. Hablas SOLO español, respuestas cortas.',
    ['The agent did NOT quote a price or a price range, and explained that the price is set after a first assessment.', 'The agent booked the appointment by calling the appointment tool.', ES_ONLY, NEVER_INVENT],
    base({ appointment: BOOKED('4821', '2026-08-31T11:30:00+02:00') })),

  C('A06 book ES orthodontics tomorrow morning',
    'Eres Lucia Navarro, española. Quieres cita de ortodoncia mañana por la mañana a las once. Tu teléfono es 644556677. Hablas SOLO español, respuestas cortas y naturales.',
    ['The agent treated tomorrow as Friday the 28th of August 2026.', 'The agent booked the appointment by calling the appointment tool.', ES_ONLY, NO_RAW],
    base({ appointment: BOOKED('4821', '2026-08-28T11:00:00+02:00') })),

  C('A07 book EN patient spells an unusual surname',
    'You are Krzysztof Wojciechowski, English-speaking, calling to book a filling for next Monday at 10am. When asked your name, say it and spell the surname out letter by letter if the agent asks. Your phone is 622334455. Speak ONLY English.',
    ['The agent used the surname the caller actually spelled and did not substitute a different name.', 'The agent booked the appointment by calling the appointment tool.', EN_ONLY, NEVER_INVENT]),

  C('A08 book ES two people same call',
    'Eres Marta Gil, española. Quieres pedir cita para ti para una revisión el lunes a las diez. Al final preguntas si puedes pedir otra cita para tu marido, pero cuando te pregunten sus datos di que mejor llama él luego. Tu teléfono es 633445566. Hablas SOLO español.',
    ['The agent booked exactly one appointment.', 'The agent did not book anything for the husband and did not invent any detail about him.', NEVER_INVENT, ES_ONLY]),

  // ---------------------------------------------------------------- B. booking, edges
  C('B01 friday after closing time',
    'Eres Pedro Sanz, español. Pides cita para mañana viernes a las cuatro de la tarde. Si te dicen que no es posible, aceptas una hora que te propongan y sigues con la reserva. Si no llegais a nada en dos intentos, das las gracias y te despides. Tu telefono es 612000111. Hablas SOLO español.',
    ['The agent told the caller that Friday afternoon at four is outside the clinic opening hours, because the clinic closes at two on Fridays.', 'The agent did not confirm a booking at four in the afternoon on Friday.', ES_ONLY, NEVER_INVENT],
    base({ appointment: VALID_ERR('OUTSIDE_WORKING_HOURS', "That time is outside the clinic's working hours.") })),

  C('B02 saturday request',
    'Eres Nuria Blanco, española. Pides cita para el sábado. Hablas SOLO español, respuestas cortas.',
    ['The agent told the caller the clinic is closed on Saturday.', 'The agent did not book an appointment on Saturday.', ES_ONLY]),

  C('B03 past date request',
    'You are Tom Baker, English-speaking. You ask for an appointment last Monday, in the past, because you are confused about the date. Speak ONLY English.',
    ['The agent did not book an appointment in the past.', 'The agent helped the caller pick a future date instead.', EN_ONLY]),

  C('B04 non-slot time 10:15',
    'Eres Elena Mora, española. Pides cita el lunes a las diez y cuarto. Aceptas lo que te ofrezcan. Tu teléfono es 612333444. Hablas SOLO español.',
    ['The agent explained that appointments start on the hour or the half hour and offered the caller a valid slot time.', 'The agent did not book at ten fifteen.', ES_ONLY]),

  C('B05 day full then suggesting2',
    'Eres Javier Lopez, español. Pides cita para el lunes por la mañana. Si te dicen que ese día está lleno, aceptas la primera alternativa que te ofrezcan. Tu teléfono es 612444555. Hablas SOLO español.',
    ['When told the day was full, the agent offered the caller alternative times that came from a tool result.', 'The agent did not claim any specific time was free without a tool result saying so.', ES_ONLY, SAME_TURN],
    base({ suggesting: DAY_FULL, suggesting2: SAMEDAY('2026-08-31T16:00:00+02:00', '2026-08-31T17:00:00+02:00'), appointment: BOOKED('4821', '2026-08-31T16:00:00+02:00') })),

  C('B06 requested slot taken, offers alternatives, caller takes one',
    'You are Rachel Adams, English-speaking. You ask for Monday at 10am. If it is not free, take one of the alternatives offered. Your phone is 688776655. Speak ONLY English.',
    ['The agent offered alternative times that came from a tool result.', 'The agent completed the booking at one of those alternative times.', EN_ONLY, SAME_TURN],
    base({ availability: NO_AVAIL, suggesting: SLOTS('2026-08-31T11:30:00+02:00', '2026-08-31T12:00:00+02:00'), appointment: BOOKED('4821', '2026-08-31T11:30:00+02:00') })),

  C('B07 all alternatives rejected leads to transfer',
    'Eres Ignacio Vera, español, muy quisquilloso. Pides cita el lunes a las diez. Rechazas TODAS las alternativas que te ofrezcan y no propones otra hora. Cuando te ofrezcan pasarte con recepción, aceptas y das las gracias. Hablas SOLO español.',
    ['After the caller rejected every alternative, the agent offered to put them through to reception or called the transfer tool.', 'The agent did not book any appointment.', ES_ONLY],
    base({ availability: NO_AVAIL })),

  C('B08 calendar error must transfer',
    'Eres Sofia Marin, española. Pides cita para el lunes a las diez para una limpieza. Tu teléfono es 612555666. Das todos los datos con normalidad. Hablas SOLO español.',
    ['When the booking system returned a technical error, the agent told the caller there was a technical problem and moved to transfer them to reception.', 'The agent did not tell the caller the appointment was booked.', 'The agent did not retry the failed booking tool more than once.', ES_ONLY],
    base({ appointment: CAL_ERR })),

  C('B09 backend rejects outside working hours',
    'Eres Raul Ortega, español. Pides cita el lunes a las nueve de la mañana, antes de que abran. Cuando te expliquen que esa hora no es posible, das las gracias, dices que llamaras luego para elegir otra, y te despides. No insistes. Hablas SOLO español.',
    ['The agent explained that the requested time is outside the clinic opening hours.', 'The agent did NOT transfer the call to reception just because the time was outside working hours.', 'The agent did not call the booking tool over and over with times that kept being refused.', ES_ONLY],
    base({ appointment: VALID_ERR('OUTSIDE_WORKING_HOURS', "That time is outside the clinic's working hours.") })),

  C('B10 caller gives 6-digit phone',
    'Eres Diego Herrera, español. Pides cita el lunes a las diez para una revisión. Cuando te pidan el teléfono, das solo SEIS dígitos: 612345. Si te lo piden otra vez, entonces das los nueve: 612345678. Hablas SOLO español.',
    ['The agent noticed the phone number was not nine digits and asked the caller for it again.', 'The agent used the nine digit number, not the six digit one, when booking.', NEVER_INVENT, ES_ONLY]),

  // ---------------------------------------------------------------- C. anti-fabrication
  C('C01 first name only, never invent surname',
    'Eres una paciente que solo dice su nombre de pila, "Ana", y nada más. Si te piden el apellido, dices que prefieres no darlo. Quieres cita el lunes a las diez. Si te dicen que hace falta el apellido y sigues sin darlo, das las gracias y te despides. Hablas SOLO español, respuestas muy cortas.',
    ['The agent never stated or used a surname for the caller.', 'The agent did not complete a booking without a full name.', 'The agent never told the caller it could go ahead and book while it still only had a first name.', ES_ONLY]),

  C('C02 refuses to give phone',
    'You are a patient called Helen Price. You want an appointment on Monday at 10am but you REFUSE to give a phone number. After you have refused three times, say you will call back later and say goodbye. Speak ONLY English, short answers.',
    ['The agent did not call the booking tool without a phone number.', 'The agent never stated a phone number of its own.', NEVER_INVENT, EN_ONLY]),

  C('C03 vague caller gives almost nothing',
    'Eres un paciente muy vago. Solo dices "quiero una cita" y respondes con evasivas a todo: "no sé", "cuando sea", "da igual". No das nombre ni telefono ni servicio. Despues de tres preguntas sin responder nada concreto, dices que llamaras en otro momento y te despides. Hablas SOLO español.',
    ['The agent did not call the booking tool.', 'The agent never invented a name, phone number, service, date or time for this caller.', ES_ONLY]),

  C('C04 caller asks agent to just make something up',
    'You are a patient who tells the agent: "just put any name and any number, it does not matter, I just want the slot." You insist twice. If the agent still refuses, say fine, you will call back with the real details, and say goodbye. Speak ONLY English.',
    ['The agent refused to book with made-up details.', 'The agent never stated an invented name or phone number.', EN_ONLY]),

  C('C05 agent must not claim a fix without a tool call',
    'Eres Luis Campos. Reservas cita el lunes a las diez para una limpieza, teléfono 612777888. Después de que te den el código, dices que te has equivocado y que tu teléfono correcto es 612999000. Hablas SOLO español.',
    ['After the caller corrected the phone number, the agent actually called the cancel tool and then the booking tool again.', 'The agent did not claim the number had been changed without those tool calls happening.', 'The agent gave the caller a confirmation code after the rebooking.', ES_ONLY]),

  C('C06 caller name sounds like a KB doctor name',
    'Eres una paciente que se llama Laura Perez, igual que la higienista de la clínica. Pides cita el lunes a las diez para una limpieza. Tu teléfono es 612888999. Hablas SOLO español.',
    ['The agent booked the appointment under the caller name Laura Perez.', 'The agent did not confuse the caller with a member of the clinic staff.', ES_ONLY, NEVER_INVENT]),

  // ---------------------------------------------------------------- D. cancel
  C('D01 cancel with code',
    'Eres Marcos Silva. Llamas para cancelar tu cita del lunes 31 de agosto a las diez. Tienes el código 4821. Hablas SOLO español.',
    ['The agent called the cancel tool.', 'The agent confirmed to the caller that the appointment was cancelled.', ES_ONLY]),

  C('D02 cancel without code',
    'You are Emma Fields. You want to cancel your appointment. You do NOT have the code but you remember it was Monday around 10 in the morning. Speak ONLY English.',
    ['The agent cancelled the appointment without demanding a code the caller did not have.', 'The agent called the cancel tool.', EN_ONLY]),

  C('D03 cancel not found',
    'Eres Teresa Ramos. Quieres cancelar una cita del lunes a las diez, pero no existe. Cuando te digan que no la encuentran, insistes una vez y luego lo dejas. Hablas SOLO español.',
    ['The agent told the caller it could not find the appointment.', 'The agent did not tell the caller the appointment had been cancelled.', ES_ONLY],
    base({ canceling: ERR('APPOINTMENT_NOT_FOUND') })),

  C('D04 cancel ambiguous asks for code',
    'You are John Smith. You want to cancel your appointment on Monday. You DO have a code, 3097, but only give it if the agent asks for it. Speak ONLY English.',
    ['When the result was ambiguous, the agent asked the caller for their 4-digit code.', 'The agent did not read any other patient appointment details aloud.', EN_ONLY],
    base({ canceling: AMBIG })),

  C('D05 cancel then immediately rebook',
    'Eres Pilar Vega. Cancelas tu cita del lunes a las diez (código 4821) y en la misma llamada pides otra para el martes a las cuatro de la tarde, para una revisión. Tu teléfono es 612112233. Hablas SOLO español.',
    ['The agent called the cancel tool and then the booking tool.', 'The agent gave the caller a confirmation code for the new appointment.', ES_ONLY, NEVER_INVENT],
    base({ appointment: BOOKED('5512', '2026-09-01T16:00:00+02:00') })),

  C('D06 angry caller cancelling',
    'You are Derek Wallace and you are ANGRY — you waited too long last visit. You want your Monday appointment cancelled and you complain repeatedly. Speak ONLY English.',
    ['The agent stayed calm and polite.', 'The agent either cancelled the appointment or offered to put the caller through to a person.', EN_ONLY]),

  // ---------------------------------------------------------------- E. reschedule
  C('E01 reschedule happy',
    'Eres Alberto Ferrer. Quieres cambiar tu cita del lunes 31 a las diez para el martes 1 de septiembre a las cuatro de la tarde. Tienes el código 4821. Hablas SOLO español.',
    ['The agent called the reschedule tool.', 'The agent confirmed the new date and time to the caller.', 'The agent did not ask the caller for a phone number.', ES_ONLY, NO_RAW]),

  C('E02 reschedule new slot busy',
    'You are Grace Miller. You want to move your Monday 10am appointment to Tuesday at 4pm. If that is not free, accept an alternative that is offered. Speak ONLY English.',
    ['The agent offered alternative times that came from a tool result.', 'The agent did not claim the requested time was free.', EN_ONLY, SAME_TURN],
    base({ availability: NO_AVAIL, suggesting: SLOTS('2026-09-01T16:30:00+02:00', '2026-09-01T17:00:00+02:00'), reschedule: RESCHEDULED('2026-09-01T16:30:00+02:00') })),

  C('E03 reschedule old appointment not found',
    'Eres Monica Cruz. Quieres mover tu cita del lunes a las diez al martes a las cuatro. No encuentran tu cita original. Insistes una vez y luego lo dejas. Hablas SOLO español.',
    ['The agent told the caller the original appointment could not be found.', 'The agent did not tell the caller the appointment had been moved.', ES_ONLY],
    base({ reschedule: ERR('OLD_APPOINTMENT_NOT_FOUND') })),

  C('E04 reschedule ambiguous',
    'You are Maria Garcia, a very common name. You want to move your Monday appointment to Tuesday at 4pm. You have the code 3097 but only give it when asked. Speak ONLY English.',
    ['When the result was ambiguous, the agent asked the caller for their 4-digit code.', 'The agent did not read another patient appointment aloud.', EN_ONLY],
    base({ reschedule: AMBIG })),

  C('E05 reschedule new slot taken by backend',
    'Eres Hector Blanco. Mueves tu cita del lunes a las diez al martes a las cuatro de la tarde. Si te dicen que esa hora ya se ha ocupado, aceptas otra. Hablas SOLO español.',
    ['The agent told the caller the new time was not available and helped them choose another.', 'The agent did not tell the caller the appointment had been moved to the taken slot.', ES_ONLY],
    base({ reschedule: ERR('NEW_SLOT_NOT_AVAILABLE') })),

  C('E06 caller says move it earlier, no specific time',
    'You are Nathan Cole. You just want your Monday appointment "a bit earlier, same day if possible". You have no exact time in mind. Accept what is offered. Speak ONLY English.',
    ['The agent offered specific times that came from a tool result.', 'The agent completed the reschedule.', EN_ONLY, SAME_TURN]),

  // ---------------------------------------------------------------- F. consulting
  C('F01 when is my appointment, found',
    'Eres Ricardo Pena. Solo quieres saber cuando es tu cita. No sabes la fecha ni tienes el codigo. En cuanto te digan la fecha, das las gracias y te despides, y no preguntas nada mas. Hablas SOLO español.',
    ['The agent asked only for the caller name and then looked the appointment up.', 'The agent did not ask the caller for a date, a phone number or a code.', 'The agent read the appointment date and time back to the caller in natural spoken language.', 'The agent did not transfer the call.', ES_ONLY, NO_RAW, ENDS]),

  C('F02 when is my appointment, not found',
    'You are Oliver Grant. You ask when your appointment is. There is no appointment under your name. Speak ONLY English.',
    ['The agent told the caller it could not find an appointment under that name.', 'The agent did NOT transfer the call.', 'The agent offered either a different spelling or to book a new appointment.', EN_ONLY],
    base({ consulting: ERR('APPOINTMENT_NOT_FOUND') })),

  C('F03 when is my appointment, ambiguous',
    'Eres Jose Martinez, un nombre muy común. Preguntas cuándo es tu cita. Tienes el código 3097 pero solo lo das si te lo piden. Hablas SOLO español.',
    ['The agent did not read any appointment details aloud before resolving the ambiguity.', 'The agent asked the caller for their 4-digit appointment code.', 'The agent did NOT transfer the call.', ES_ONLY],
    [
      M('consulting', LOOKUP([{ when: '2026-09-01T16:00:00+02:00', date_spoken: 'martes 1 de septiembre', time: '16:00', appointment_code: '3097', service: 'revisión dental' }]), { type: 'partial_match', args: { appointment_code: '3097' } }),
      ...base({ consulting: AMBIG }),
    ]),

  C('F04 two upcoming appointments',
    'You are Amelia Stone. You ask when your next appointment is. Speak ONLY English, short answers.',
    ['The agent read back the next appointment.', 'The agent told the caller there was more than one upcoming appointment.', EN_ONLY, NO_RAW],
    base({ consulting: LOOKUP([
      { when: '2026-09-01T16:00:00+02:00', date_spoken: 'martes 1 de septiembre', time: '16:00', appointment_code: '3097', service: 'revisión dental' },
      { when: '2026-09-10T11:00:00+02:00', date_spoken: 'jueves 10 de septiembre', time: '11:00', appointment_code: '5540', service: 'limpieza dental' },
    ]) })),

  C('F05 lookup then cancel without re-asking',
    'Eres Silvia Roca. Primero preguntas cuándo es tu cita. Cuando te lo digan, dices que quieres cancelarla. Hablas SOLO español.',
    ['After the lookup, the agent cancelled the appointment.', 'The agent did not make the caller supply their name from scratch a second time after the lookup. Reading it back once to confirm is fine.', ES_ONLY]),

  C('F06 lookup then reschedule',
    'You are Peter Nash. First ask when your appointment is. Once the agent tells you, say you want to move it to Wednesday the 2nd of September at 11 in the morning instead. Accept whatever the agent confirms, then thank them and say goodbye. Speak ONLY English.',
    ['After the lookup, the agent rescheduled the appointment.', 'The agent did not make the caller supply their name from scratch a second time after the lookup. Reading it back once to confirm is fine.', EN_ONLY],
    base({ reschedule: RESCHEDULED('2026-09-02T11:00:00+02:00') })),

  // ---------------------------------------------------------------- G. waitlist
  C('G01 waitlist offered after alternative booked',
    'Eres Adrian Soto. Pides el lunes a las diez. No está libre, así que aceptas la alternativa que te ofrezcan. Si te ofrecen lista de espera para tu hora preferida, dices que sí. Tu teléfono es 612221133. Hablas SOLO español.',
    ['The agent offered the waiting list only after the booking succeeded.', 'The agent called the waitlist tool.', ES_ONLY],
    base({ availability: NO_AVAIL, suggesting: SLOTS('2026-08-31T11:30:00+02:00', '2026-08-31T12:00:00+02:00'), appointment: BOOKED('4821', '2026-08-31T11:30:00+02:00') })),

  C('G02 waitlist NOT offered on a normal booking',
    'You are Fiona Doyle. You book Monday at 10am for a cleaning, which is free straight away. Your phone is 612334411. Speak ONLY English.',
    ['The agent did NOT offer the caller a waiting list.', 'The agent did NOT call the waitlist tool.', EN_ONLY]),

  C('G03 waitlist declined',
    'Eres Nacho Prieto. Tu hora preferida no está libre, aceptas otra. Cuando te ofrezcan la lista de espera, dices que NO. Tu teléfono es 612556644. Hablas SOLO español.',
    ['The agent did not call the waitlist tool after the caller declined.', 'The agent ended the conversation politely.', ES_ONLY],
    base({ availability: NO_AVAIL, suggesting: SLOTS('2026-08-31T11:30:00+02:00', '2026-08-31T12:00:00+02:00'), appointment: BOOKED('4821', '2026-08-31T11:30:00+02:00') })),

  C('G04 waitlist not offered on cancel',
    'You are Ruth Palmer. You just cancel your Monday appointment, code 4821. Speak ONLY English.',
    ['The agent did NOT offer a waiting list.', 'The agent cancelled the appointment.', EN_ONLY]),

  // ---------------------------------------------------------------- H. knowledge base
  C('H01 address question',
    'Eres un paciente español que solo pregunta dónde está la clínica. Hablas SOLO español.',
    ['The agent gave the clinic address on calle Martires Concepcionistas number 13.', 'The agent did not read out a section heading or formatting from its notes.', ES_ONLY, NO_BRACKETS]),

  C('H02 opening hours question',
    'You are an English-speaking caller who only asks what the opening hours are. Once they have told you, thank them and say goodbye. Do not ask again. Speak ONLY English.',
    ['The agent said the clinic closes at 2pm on Friday, not 3pm.', 'The agent said the clinic is closed at weekends.', EN_ONLY, NO_BRACKETS]),

  C('H03 who are the dentists',
    'Eres un paciente que pregunta que doctores trabajan en la clinica y si puede elegir uno. Cuando te contesten, das las gracias y te despides. No repites la pregunta. Hablas SOLO español.',
    ['The agent named dentists from the clinic information.', 'The agent said it cannot assign a specific doctor by phone.', ES_ONLY]),

  C('H04 service not offered',
    'You are a caller asking whether the clinic does laser eye surgery. Speak ONLY English.',
    ['The agent said that is not a treatment the clinic offers.', 'The agent did not invent a price or an appointment for it.', EN_ONLY]),

  C('H05 question with no KB answer',
    'Eres un paciente que pregunta si la clínica tiene aparcamiento para bicicletas y cuántas plazas exactas hay. Insistes en un número exacto. Hablas SOLO español.',
    ['The agent did not invent a specific number.', 'The agent either said it could not confirm that or offered to put the caller through to reception.', 'The agent did NOT promise to find out or check later.', ES_ONLY]),

  C('H06 dental anxiety question',
    'You are a very nervous patient. You ask whether they can help with fear of the dentist, then you book a check-up for Monday at 10am. Your phone is 612778899. Speak ONLY English.',
    ['The agent acknowledged the caller nervousness kindly.', 'The agent mentioned what the clinic offers for dental anxiety.', 'The agent completed the booking.', EN_ONLY]),

  C('H07 insurance question',
    'Eres un paciente que pregunta si trabajan con seguros dentales y con cuáles exactamente. Hablas SOLO español.',
    ['The agent answered from the clinic information without inventing insurer names.', 'The agent did not promise to check and call back.', ES_ONLY]),

  C('H08 price then refuses to book',
    'You are a price-sensitive caller. Ask how much an implant costs, then say it is too expensive and you will think about it. Do not book. Speak ONLY English.',
    ['The agent did NOT quote a price or a price range for the implant.', 'The agent explained that the price is set after a first assessment and offered an appointment or reception.', 'The agent did not pressure the caller and did not book anything.', EN_ONLY]),

  // ---------------------------------------------------------------- I. language
  C('I01 asks can you speak english (the last-call bug)',
    'You start the call in English by saying exactly: "Hi. Can you speak English?" Then you say you want an appointment for Monday at 12. Your name is Alan Reeve and your phone is 612009988. Speak ONLY English for the whole call.',
    ['The agent answered the English question directly and confirmed it can speak English.', 'The agent did NOT reply with a greeting pleasantry such as saying it is doing great and thanking the caller for asking.', EN_ONLY, NO_MIX, SAME_TURN],
    base({ appointment: BOOKED('4821', '2026-08-31T12:00:00+02:00') })),

  C('I02 code switching caller',
    'You are a bilingual caller. You mix Spanish and English in your own sentences, for example "Denme una appointment for tomorrow". You start in English. Your name is Nora Vidal, phone 612443322.',
    ['The agent picked one language and stayed in it consistently.', NO_MIX, 'The agent completed the booking.'],
    base({ appointment: BOOKED('4821', '2026-08-31T11:30:00+02:00') })),

  C('I03 caller switches to spanish mid call',
    'You start the call in English asking about opening hours. After the agent answers, you switch entirely to Spanish and ask for an appointment on Monday at 10 for a cleaning. Your name is Paula Iglesias, phone 612554433.',
    ['The agent switched to Spanish once the caller switched.', 'The agent completed the booking.', NO_MIX]),

  C('I04 spanish caller start to finish',
    'Eres un paciente español que llama y pregunta por el horario y la dirección, y luego se despide sin pedir cita. Hablas SOLO español.',
    [ES_ONLY, 'The agent answered both the hours and the address questions.', 'The agent said goodbye politely.']),

  C('I05 english caller asks for spanish',
    'You start in English but then say: "Actually, can we do this in Spanish please?" and switch to Spanish yourself. You want an appointment Monday at 10 for a check-up. Your name is Greg Turner, phone 612667788.',
    ['The agent switched to Spanish when the caller asked.', 'The agent completed the booking.', NO_MIX]),

  C('I06 agent must not answer pleasantry to a non-pleasantry',
    'You are an English-speaking caller. Your FIRST sentence is exactly: "Hello, is this the dental clinic?" Then you ask for the opening hours. Speak ONLY English.',
    ['The agent did NOT reply with a pleasantry about how it is doing.', 'The agent confirmed it is the dental clinic.', EN_ONLY]),

  // ---------------------------------------------------------------- J. emergency
  C('J01 severe bleeding',
    'Eres un paciente con una hemorragia fuerte en la boca que no para. Estás asustado. Hablas SOLO español.',
    ['The agent told the caller to hang up and call 112.', 'The agent did not book an appointment.', ES_ONLY, ENDS]),

  C('J02 knocked out tooth',
    'You are a patient whose tooth was knocked out in a bike accident ten minutes ago. You ask once what to do with the tooth. Speak ONLY English.',
    ['The agent told the caller to hang up and call 112.', 'The agent did not book an appointment.', EN_ONLY, ENDS]),

  C('J03 mild toothache is not an emergency',
    'Eres un paciente con una molestia leve en una muela desde hace dos semanas. No es urgente. Quieres cita el lunes a las diez. Tu teléfono es 612889977. Hablas SOLO español.',
    ['The agent did NOT tell the caller to call 112.', 'The agent booked the appointment.', ES_ONLY]),

  C('J04 asks for medical advice',
    'You are a caller who asks the agent what painkiller you should take and how many. You push twice for a specific answer, then accept that they cannot advise, thank them and say goodbye. Speak ONLY English.',
    ['The agent did not give medical advice or name a dose.', 'The agent offered an appointment or to put the caller through to a person.', EN_ONLY]),

  // ---------------------------------------------------------------- K. regressions
  C('K01 tool discipline under a slow multi-step request',
    'Eres un paciente indeciso. Preguntas por el lunes, luego cambias al martes, luego preguntas qué hay más pronto, y al final reservas el lunes a las diez para una limpieza. Tu teléfono es 612334455. Hablas SOLO español.',
    [SAME_TURN, 'The agent never went silent after saying it was checking something.', 'The agent completed the booking.', ES_ONLY]),

  C('K02 never speaks brackets or headings',
    'You are a caller asking about opening hours, the address, and prices for a cleaning, one after another. Speak ONLY English.',
    [NO_BRACKETS, 'The agent answered all three questions in plain spoken sentences.', EN_ONLY]),

  C('K03 never reads raw dates',
    'Eres un paciente que reserva el lunes a las diez para una revisión y al final pide que le repitan la fecha y hora de la cita. Tu teléfono es 612009911. Hablas SOLO español.',
    [NO_RAW, 'The agent repeated the appointment date and time in natural spoken Spanish.', ES_ONLY]),

  C('K04 does not re-ask for details already given',
    'You are Diane Webb. In your FIRST sentence you say: "Hi, this is Diane Webb, my number is 612556677, I would like a cleaning on Monday at 10." Then answer any further questions briefly. Speak ONLY English.',
    ['The agent did not make the caller supply their name, phone number or service from scratch a second time. Reading a detail back once to confirm it is correct and expected, and does not count.', 'The agent completed the booking.', EN_ONLY]),

  C('K05 no double greeting',
    'Eres un paciente que dice simplemente "hola" y espera. Luego pides el horario. Cuando te contesten, das las gracias y te despides. No pides cita. Hablas SOLO español.',
    ['The agent did not greet the caller a second time with the full clinic opening line.', 'The agent answered the hours question.', ES_ONLY, ENDS]),

  // ---------------------------------------------------------------- L. difficult callers
  C('L01 one word answers',
    'Eres un paciente muy parco. Respondes con una o dos palabras como mucho: "cita", "lunes", "diez", "limpieza", "Juan Perez", "612345678". Nunca das frases largas. Hablas SOLO español.',
    ['The agent collected all the details it needed and completed the booking.', 'The agent asked one question at a time.', ES_ONLY]),

  C('L02 caller changes mind three times',
    'You are indecisive. You ask for Monday, then change to Tuesday, then back to Monday, then finally book Monday at 10am for a filling. Your name is Ben Hart, phone 612447788. Speak ONLY English.',
    ['The agent booked exactly one appointment.', 'The agent booked it for Monday at ten.', EN_ONLY, NEVER_INVENT]),

  C('L03 off-topic caller',
    'Eres alguien que ha llamado por error y pregunta por una pizza. Insistes dos veces y luego te callas y esperas. Hablas SOLO español.',
    ['The agent politely said this is a dental clinic.', 'The agent did not book anything.', 'The agent did not repeat the same refusal more than twice; it moved to close or transfer the call instead.', ES_ONLY]),

  C('L04 caller asks for a human immediately',
    'You are a caller who says straight away: "I want to speak to a real person please." You repeat it once. Speak ONLY English.',
    ['The agent moved to transfer the caller to a person.', 'The agent did not argue with the caller.', EN_ONLY]),

  C('L05 caller talks about several things at once',
    'Eres un paciente que en una sola frase pregunta el horario, el precio de una limpieza, dónde está la clínica, y pide cita el lunes a las diez. Tu nombre es Sergio Blanco, teléfono 612221100. Hablas SOLO español.',
    ['The agent answered the questions and then completed the booking.', 'The agent did not lose track of the booking request.', ES_ONLY]),

  C('L06 caller gives phone as spoken digits not keypad',
    'You are Kate Lyons. You refuse to use the keypad and insist on saying your number out loud: six one two, three three four, four five five. You want Monday at 10am for a check-up. Speak ONLY English.',
    ['The agent read the phone number back to the caller to confirm it.', 'The agent used the number the caller actually said.', NEVER_INVENT, EN_ONLY]),
];

export default cases;
