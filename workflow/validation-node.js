// =====================================================================
//  BAYTON - INPUT VALIDATION NODE  (n8n "Code" node, Run Once for All Items)
//  Place: Webhook  ->  [Validate Input]  ->  IF "Is Valid?"  ->  Switch / Error
//  Purpose: enforce in the BACKEND what was previously only enforced by the
//           AI prompt: working hours, past dates, weekends, 30-min slots,
//           required fields, unknown actions, (optional) webhook auth.
// =====================================================================

const item   = $input.first().json;
const args   = item?.body?.args || {};
const action = String(args.action || "").toLowerCase();

// ---------- CONFIG ----------
const WORK_START_HOUR        = 10;   // clinic opens 10:00
const WORK_END_HOUR_DEFAULT  = 20;   // Mon-Thu closes 20:00
const WORK_END_HOUR_FRIDAY   = 15;   // Fri closes 15:00
const VALID_MINUTES          = [0, 30];          // only HH:00 / HH:30
const KNOWN_ACTIONS = ["availability","book","reschedule","canceling","suggesting","suggesting2"];

// Optional webhook auth. Turn ON only AFTER you add the same header in Retell.
const REQUIRE_TOKEN = false;                       // <-- set true to enforce
const EXPECTED_TOKEN = "bayton_live_change_me";    // <-- your secret
// ----------------------------

function fail(code, message) {
  return [{ json: { ...item, _validation: { ok: false, error: code, message } } }];
}
function pass() {
  return [{ json: { ...item, _validation: { ok: true } } }];
}

// 1) Optional auth check
if (REQUIRE_TOKEN) {
  const headers = item?.headers || {};
  const token = headers["x-webhook-token"] || headers["X-Webhook-Token"];
  if (token !== EXPECTED_TOKEN) return fail("UNAUTHORIZED", "Invalid or missing webhook token.");
}

// 2) Unknown action
if (!KNOWN_ACTIONS.includes(action)) {
  return fail("UNKNOWN_ACTION", `Unknown action: '${action}'.`);
}

// 3) Required-field checks per action
const required = {
  book:       ["name","Email","phone","service","booking_time"],
  reschedule: ["name","booking_time1","reschedule_time1"],
  canceling:  ["name","time1"],
  availability:["required_time"],
  suggesting: ["required_time"],
  suggesting2:["local_time"]
}[action] || [];

for (const f of required) {
  if (args[f] === undefined || args[f] === null || String(args[f]).trim() === "") {
    return fail("MISSING_FIELD", `Missing required field: ${f}`);
  }
}

// 4) Time/hours validation — only for actions that create or check a real slot.
//    suggesting / suggesting2 are search helpers and must NOT be blocked.
const timeField = { availability: args.required_time, book: args.booking_time, reschedule: args.reschedule_time1 }[action];

if (["availability","book","reschedule"].includes(action)) {
  let s = String(timeField);
  if (!s.includes("+") && !s.includes("Z")) s += "+02:00";

  const d = new Date(s);
  if (isNaN(d.getTime())) return fail("INVALID_DATE_FORMAT", "The date/time format is invalid.");

  // Express the instant as Madrid wall-clock (same trick used in the other Code nodes)
  const madrid = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const nowMad = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));

  // a) past date — block only for actions that write a booking
  if ((action === "book" || action === "reschedule") && madrid <= nowMad) {
    return fail("PAST_DATE", "That time is in the past.");
  }

  // b) weekend
  const dow = madrid.getDay();               // 0=Sun ... 6=Sat
  if (dow === 0 || dow === 6) {
    return fail("OUTSIDE_WORKING_HOURS", "The clinic is closed on weekends.");
  }

  // c) working hours (a 30-min slot must finish before closing)
  const endHour = (dow === 5) ? WORK_END_HOUR_FRIDAY : WORK_END_HOUR_DEFAULT;
  const t = madrid.getHours() + madrid.getMinutes() / 60;
  if (t < WORK_START_HOUR || t > (endHour - 0.5)) {
    return fail("OUTSIDE_WORKING_HOURS", "That time is outside the clinic's working hours.");
  }

  // d) 30-minute slot only
  if (!VALID_MINUTES.includes(madrid.getMinutes())) {
    return fail("INVALID_SLOT", "Appointments are only on the hour or half hour (HH:00 or HH:30).");
  }
}

return pass();
