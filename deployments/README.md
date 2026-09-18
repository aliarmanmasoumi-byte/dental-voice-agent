# Deployments

The same system, as three different clinics. Everything client-identifying — names,
addresses, phone numbers, domains — has been replaced with examples.

| | Languages | What is different about it |
|---|---|---|
| **clinic A** (the root of this repo: `agent/`, `workflow/`) | es · en | The reference build. Single site, one calendar, Spanish-first with English fallback |
| **clinic-b-trilingual** | es · en · zh-CN | Adds Mandarin. Built by duplicating clinic A and making eleven anchored edits — the prompt is deliberately *not* rewritten, because the tested prompt is the asset |
| **clinic-c-multidoctor** | es · en | Several practitioners, so availability has to resolve *which* doctor before it can answer "do you have anything Tuesday?". One calendar per doctor, plus after-hours and error-handler workflows |

## Why a duplicate and not a template

Making clinic B a parameterised template would have meant rewriting the prompt that eight
rounds of testing had converged on, and the score would have been unknown again from that
moment. Eleven targeted edits to a 26k-character prompt keeps the measurement.

That is the right trade at three clinics. It is the wrong one at thirty, which is the point
where the prompt has to become data and the tests have to run per tenant.

## clinic-c: what the multi-doctor case changes

With one practitioner, "is Tuesday at four free?" is a single calendar query. With four, the
agent has to decide whether the caller asked for a person, a treatment that only one person
does, or no preference at all — and each answer hits a different calendar. That decision is
made in the workflow, not in the prompt: `WF1-check-availability` fans out and merges, so the
agent asks one question and gets one answer.
