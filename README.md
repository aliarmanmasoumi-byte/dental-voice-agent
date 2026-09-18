# Dental voice agent

**A production phone agent for dental clinics.** It answers the line, holds a conversation in
the caller's language, checks the real calendar, books, reschedules and cancels — and it was
taken from "sounds impressive in a demo" to a measured score by running six hundred graded
conversations against it.

`Retell` (voice runtime) · `n8n` (booking backend) · `Google Calendar` · `Twilio` SIP · `gpt-4.1`

Three clinics run on it: a Spanish/English agent, a trilingual one that adds Mandarin, and a
multi-doctor bilingual deployment. Client-identifying details are replaced with examples.

---

## The measured part

This is the part most voice-agent projects do not have. `test/sim/` is a simulated-patient
harness: 75 written scenarios, each played against the live agent by a second model acting as
the caller, with the booking tools mocked, and a third model grading the transcript against
that scenario's pass criteria.

| | |
|---|---|
| **10/75 → 69/75** | eight rounds on suite 1 |
| **60/75** | a second, independently written suite |
| ~600 | graded conversations |
| 85% | average pass rate over the last three runs; 73% of scenarios right *every* time |

```bash
cd test/sim
RETELL_KEY=key_… node run.mjs        # play all 75 and grade them
node summary.mjs                     # per-scenario pass/fail
node sweep.mjs                       # the same suite across N candidate models
```

### What the suites actually caught

The defects worth listing are the ones no amount of reading the prompt would have found:

- **The agent answered in the wrong language, and the prompt was innocent.** The runtime was
  auto-injecting *"always respond in English"* from the agent's `language` array, because
  `en-US` happened to be first in it.
- **The agent recited the examples.** Every `e.g. "…"` in a prompt or a tool description got
  read aloud to the caller instead of being used, and whole calls ended with `tool_calls: []`.
  Quote only what is meant to be spoken verbatim; describe everything else.
- **It was the model, not the prompt.** A sweep across 19 candidates on one unchanged prompt
  scored gpt-4.1 at 70/75 against gpt-5-mini's 58/75, and glued or mixed-up turns went from
  11 to 0. Some defects do not have a prompt fix.
- **It booked Friday at 16:00 at a clinic that shuts at 14:00** — the prompt and the backend
  disagreed about opening hours for a week and no test had ever asked.
- **A second, independently written suite found three things the first structurally could
  not**: it read a patient's appointment out to a caller claiming to be the neighbour, it
  confirmed free treatment that the caller had invented, and it passed the caller's entire
  question in as the patient's *name*.
- Chain-of-thought leaking into speech, `end_call` never being invoked, and validation errors
  silently becoming transfers.

Still open and honest about it: it does not read a **spoken** phone number back to the caller
before booking. Four attempted fixes failed.

---

## Layout

```
agent/                the frozen, tested configuration — prompt, 11 tools, KB, model settings
  prompt.txt            25.9k chars
  tools.json            the tool contracts the model is held to
  RESULTS.md            what it scored and what does not port to another runtime
workflow/             the booking backend
  n8n-booking-workflow.json    52 nodes: availability, book, reschedule, cancel, lookup
  validation-node.js           the guard every request passes through first
deploy/               one command to stand the whole thing up in a fresh account
test/sim/             the simulated-patient harness above
deployments/          the same system as three different clinics
```

---

## Deploy

```bash
cp .env.example .env            # Retell + Twilio + the n8n webhook token
node deploy/deploy.mjs          # dry run — prints what it would do, changes nothing
node deploy/deploy.mjs --apply  # create the knowledge base, the LLM and the agent
node deploy/deploy.mjs --number # move the phone number onto it
node deploy/deploy.mjs --verify # diff what landed against agent/
node deploy/deploy.mjs --status # one-screen health check
```

The dry run is the default on purpose. A deployer that does something the first time you run
it is a deployer you cannot read.

---

## Lessons that cost the most

**A rule belongs in the tool's parameter description, not in the prompt.** Proved three
separate times. The model reads the schema of the thing it is about to call far more
faithfully than a paragraph twenty thousand characters up.

**"Must look like Y" beats "never send X".** Negative rules stop working reliably once a
prompt passes ~20k characters; a positive shape for the value keeps working.

**A transcript is not evidence that a tool ran.** Tool calls do not appear in
`transcript_object`, so a conversation can read perfectly while nothing at all was booked.
The suite checks the mock, not the transcript.

**Published agent versions are immutable.** The phone number points at the draft on purpose,
so a fix is live the moment it is patched.
