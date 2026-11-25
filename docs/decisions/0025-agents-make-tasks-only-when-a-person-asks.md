# 0025: Agents make tasks only when a person asks

Status: accepted, 25 Nov 2026. Decided by Simon in chat. Builds on [0014](0014-a-mention-starts-a-conversation-not-a-task.md), narrowing who may decide that work becomes a task.

## Problem

0014 made a mention a conversation, but the runner's instructions and the board skill still let an agent create a task when it judged "the work is worth tracking". Simon wants a question to stay a question: a task appears only when he wants one.

## Options

| Option | Good | Cost |
|---|---|---|
| Agents decide when work is worth a task | Nothing tracked is forgotten | Tasks appear that nobody asked for |
| Agents make a task only when a person asks, and may offer one | The board holds only work people chose | Work stays untracked until someone says yes |

## Choice

An agent answers questions and requests in the thread. It runs `flockr tasks create` only when a person asks for a task; if work looks worth tracking, it offers and waits for a yes. The runner's instructions (`apps/runner/src/prompt.ts`) and the board skill say so.

## Why

The person decides what is tracked work; the agent's job is to answer and to offer.

## Costs

- It is an instruction, not a rule the API enforces: an agent's key can still create tasks.
- Work a person forgets to turn into a task is not tracked.
