# Era 1 — final Retell state (frozen 2026-08-29)

The agent as it stood when it left Retell. Nothing here is edited again.

| | |
|---|---|
| model | gpt-4.1 @ temperature 0 |
| prompt | 25888 chars |
| tools | 11 |
| language | ["es-ES","en-US"] |
| STT | custom {"provider":"soniox","endpointing_ms":500} |
| denoising / ambient / volume | noise-cancellation / off / 1 |
| boosted keywords | 85 |

## Measured on Retell's own simulation testing
| suite | last score |
|---|---|
| suite 1 (cases.mjs) | 69/75 |
| suite 2 (cases2.mjs, independent) | 60/75 |

Stability across the last 3 runs of each: 85% average pass rate, 73% of scenarios
right every time, 22% flaky, 5% never right (mostly defects in the test cases).

Voice layer (STT / turn-taking / TTS) was never tested — 0%.

## Retell-specific things that do NOT carry over
- Retell auto-injected "always respond in <language[0]>" from the agent's language array.
  That injection was the root cause of the worst language bug, and it does not exist elsewhere.
- `{{current_time_Europe/Madrid}}` and `{{current_calendar_Europe/Madrid}}` were filled by
  Retell. Anywhere else they stay as literal braces unless something fills them.
- `execution_message` was plumbed as a tool argument by Retell, not by the model.
