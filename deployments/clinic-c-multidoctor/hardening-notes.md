================================================================
   MASOUMI CLINIC (Agent: Sara) — HARDENING & LAUNCH-PREP
   Date: 2026-06-11
   Goal: bring Masoumi from ~57/100 to ~85/100 (match Bayton's level).
================================================================

STARTING STATE (evidence-based audit)
  - All 7 workflows deployed & active in n8n, real credentials wired.
  - Agent "Sara" (gpt-4o) existed but: unpublished (v1), NO phone
    number, ZERO recent executions (built but never launched/used).
  - Backend booking did NOT enforce past dates, working hours, or the
    45-min slot grid (only doctor + required fields + valid datetime).
  - Reschedule (WF4) did NOT validate the new time at all — it even
    allowed moving an appointment to a Sunday.
  - Agent had NO "time" tool, so it had no reliable current date.

WHAT WAS DONE
  1) WF2 (Book) backend hardening — "Prepare & Validate" node now
     enforces, in the backend:
        PAST_DATE, OUTSIDE_WORKING_HOURS (weekend + open/close window),
        INVALID_SLOT (45-min grid from 10:00), plus the existing
        DOCTOR_NOT_FOUND / MISSING_REQUIRED_FIELDS / INVALID_DATETIME.
     "Respond Invalid" now returns the specific error code + detail
     (was a generic "Invalid request" message).
  2) WF4 (Reschedule) backend hardening — "Prepare Search" now applies
     the same checks to new_datetime (past / weekend / hours / 45-min
     slot / invalid format). "Respond Invalid" echoes the code too.
  3) Sara prompt + tools (Retell LLM llm_df20b49af8140807c5e28b0c8327):
       - Added a "time" tool (https://time.ambitnhouse.com/vapi) so Sara
         has a real current date (it had none before).
       - Prompt: "CURRENT DATE & TIME" section (use the time tool,
         convert relative dates, never guess) + seasonal timezone note
         (+02:00 summer / +01:00 winter, don't hard-code).
       - Prompt: "HANDLING BOOKING/RESCHEDULE RESPONSES" section so Sara
         treats OUTSIDE_WORKING_HOURS / PAST_DATE / INVALID_SLOT / etc.
         as normal business answers (re-ask) instead of transferring.
       - (Encoding of the → arrows was already fixed; verified clean.)
  4) Published the agent (now version 2, changes snapshotted).

VERIFIED LIVE (throttle-paced, net-zero where it wrote)
  - WF2 rejections: past / weekend / after-hours / 10:15 bad slot /
    unknown doctor / missing email — all return the correct code.
  - WF2 valid booking -> success (returns appointment_id, doctor,
    specialty, datetime, duration).
  - WF3 cancel by appointment_id and by name — both work.
  - WF4 reschedule: valid move works; weekend / after-hours / bad slot
    now correctly REJECTED (the bug above is fixed).
  - check_availability routes all 4 specialties to the right doctor.
  - WF6 after-hours callback registers (bilingual reply).
  - time endpoint returns Madrid date/day-of-week.
  All test appointments were cancelled; calendars left clean.

BACKUPS (folder: Masoumi Clinic/backups_live_20260611/)
  WF1..WF7 .json (pre-change live exports), sara_LLM_backup.json,
  sara_agent_backup.json.
  ROLLBACK: PUT the WFx json back (send only name/nodes/connections/
  settings/staticData); PATCH the LLM with general_prompt+general_tools
  from sara_LLM_backup.json.

FULL-DAY TEST + WF1 BUG FIX (2026-06-11, second pass)
  Filled all 13 slots of Wed 2027-09-22 for dr-parvin, then probed.
  Found 2 real bugs in WF1 "Compute Free Slots":
   - BUG: busy events were compared as raw UTC instants while slots
     were built in Madrid wall-time -> 2h skew -> on a full day it
     offered 18:15/19:00 (actually BOOKED) as available.
   - BUG: the slot generator only checked the slot START against
     closing time, so it offered 19:45 (ends 20:30, after close).
  Fixes: busy events now pass through the same toMadridLocal()
  transform (the same approach Bayton's code nodes use); the while
  condition now requires slot END <= closing; Get Calendar Events
  got returnAll=true.
  Note: bookings were never at risk (WF2's Double-Check Slot returned
  SLOT_TAKEN correctly) — the bug only made Sara OFFER wrong times.
  Retested after fix:
   [PASS] full day -> rolls to next day (Thu 10:00/10:45/11:30)
   [PASS] empty day -> same-day slots from 10:00
   [PASS] Friday -> only slots that END by 15:00
   [PASS] all 13 test bookings cancelled by appointment_id; day clean.

STILL OPEN (business / not code)
  - *** No phone number for Sara. *** The only Twilio number
    (<CLINIC_PHONE_US>) is bound to Bayton's Santiago. Masoumi needs its
    OWN second number; then bind it to Sara's latest version. This is
    the one remaining launch step and is a business decision.
  - Optional: WF7 Sheets column mapping tidy-up; rate limiting; port
    Bayton's "unique-code-within-day" idea (Masoumi codes already embed
    the date and are unique enough in practice).
================================================================
