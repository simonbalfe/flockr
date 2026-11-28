# 13d Questions between members

Row 13d in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P83.

## Problem

Example: claude, building #812, needs to know from codex (who designed the table in #806) whether `email` is unique. Today `flockr ask 812 ...` makes a card only a person may answer, so codex cannot reply on it, codex is not woken, and Simon gets a question that is not his.

## Scope

- **Address a question:** `askInThread` takes `to?: string`, any member, agent or person, who sees the channel (`requireSeesTask`, 400 otherwise) and is not the asker. Stored in `messages.asked_to` (references `members.name`, migration `0025_questions_to`). `ThreadQuestion` shows `to`.
- **Who answers** (`answerRefusal` in `packages/contracts/src/rules.ts`, used by the server and the web app):
  - A permission card (a question with an `action`) is answered only by a person, whoever it is addressed to.
  - A question addressed to a member is answered only by that member: it stays open until they answer.
  - A question addressed to nobody is answered by a person, as before.
- **Inbox and Focus per member:** `getInbox` for a member lists the open thread questions addressed to them, plus unaddressed ones when they are a person; reviews list the tasks they review when they are an agent, all visible ones for a person. A brief (an audience, not a member) keeps seeing every open question.
- **Waking:** `question.asked` carries `to`; the runner starts a conversation in that thread for the addressed agent with the question and how to answer it (`flockr answer <thread> <option>`). The 11b rule holds (another org's agent never wakes ours), and so does the agent chain limit: four agent messages in a row wait for a person.
- **Task questions** (`askQuestion` on a task the asker holds) are unchanged: they block the holder until a person answers.
- **Out:** a question to several members, questions with free text answers, reminders for questions left open.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `to` on `askInThread` (`ThreadAskBody`); `to` on `ThreadQuestion`; per-member `getInbox` |
| `flockr` | `ask <thread> <question> --option a --option b --to codex`; `answer` works for the addressed agent; `inbox` lists what is yours |
| Web app | A question card says who it is for and shows its answer buttons only to that member (or a person when unaddressed); Focus lists only your questions. Asking from the web is skipped: people ask with a message or an @mention, and agents ask with cards |
| Runner | Wakes the addressed agent with a question prompt |
| Board skill | Ask another agent with `--to`; answer what is addressed to you |

## Rules the tests hold

`apps/server/test/questions.test.ts`:

- claude asks codex in #812's thread: simon cannot answer it (403), gemini cannot (403), codex answers and the question closes.
- A permission card addressed to codex is answered by a person only.
- An unaddressed question: an agent cannot answer (403), a person can.
- Addressing a member who cannot see the channel is 400; addressing yourself is 400.
- codex's inbox lists the question addressed to it and not the one addressed to gemini; simon's lists the unaddressed one and not codex's.
- `apps/runner/test/runner.test.ts`: `question.asked` to this agent starts one conversation with the question prompt; one to another member starts none; one from another org's agent starts none.

## Exit checklist

- [x] Column and migration, `to` on ask, `answerRefusal`, per-member inbox
- [x] `bun run generate`, MCP, `flockr ask --to`
- [x] Web: who the card is for, answer buttons by the rule
- [x] Runner wake; board skill
- [x] Tests above; `bun run check`
- [x] Master checklist row, parity row P83

## Notes from the build

- `answerRefusal` replaced the server's person-only check. A job approval card (`askApproval`) is addressed to nobody, so it still needs a person; `settleJobApproval` is unchanged.
- `flockr answer <task-id>` now answers the task's own question when it has one, else the open card in the task's thread, so an agent asked in #812's thread answers with `flockr answer 812 Yes`.
- An agent's inbox lists only what is addressed to it: thread questions with its name and the tasks it reviews (13a). Task questions, which a person answers, are left out of it.
- The runner answers each question once (`answering`, by question id), from the event or from its inbox on `drain`, mirroring reviews; a question that arrives while a run is live in that thread is sent into the run.
