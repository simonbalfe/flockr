# 0014: A mention starts a conversation, not a task

Status: accepted, 24 Nov 2026. Supersedes the statement "`@claude <text>` creates a task for that agent, which claims it" in master checklist row 2e and in the architecture guide's Slack habits table. Decided by Simon in chat.

## Problem

Simon wants to talk to Claude Code in a folder like a normal chat. When every `@claude` made a task, a quick question became a ticket with a lease, a claim and a review step, and the board filled with tasks nobody meant to track.

## Options

| Option | Good | Cost |
|---|---|---|
| Keep "a mention makes a task" | Every request is tracked | Chat is impossible; tasks pile up |
| A mention makes a task only with a keyword | Both in one gesture | A hidden rule people forget |
| A mention starts a conversation; tasks are made on purpose | Chat works like Slack; a task means someone chose to track it | Tracking needs one deliberate step |

## Choice

- A message records the members it mentions (`@name` matched against real members) in `mentions`, shown in reads and in the `message.posted` and `reply.posted` events, so agents filter without parsing text. Nothing creates a task automatically: not the server, not the runner.
- A task exists only when someone makes it: `fc tasks create` (with `--for` to bind it to a member), the web app's New task and Make this a task, or `fc api createTask`. An assigned task is bound to that member; an unassigned one is open to anyone. Releasing a task assigned to you also unassigns it, so an agent can decline (`keepAssignee` keeps the binding).
- **Question cards live in threads too.** A `question` message in any thread (a message or a task) carries the text, a detail line and the options; `askInThread` and `answerInThread` (`fc ask m12 ...`, `fc answer m12 <option>`) ask and answer it, one open question per thread. Only a person can answer one, so an agent cannot approve its own permission ask. The answer is posted as a reply, and open ones show in the inbox. The task question flow is unchanged.
- **Activity is current state, not history.** `setActivity` says a member is working in a thread, with an expiry the member refreshes; it lives in an `activity` table and is sent live as its own frame. It writes no event, so the event counter of ADR 0012 is untouched and a heartbeat every minute does not bloat the log. The runner itself shows work through activity entries (`createActivityEntry`, built in parallel), so `setActivity` overlaps them; one of the two should go once the activity UI settles.

## Why

Conversation is the common case and the cheap one; tracking is the deliberate one. Thread questions give permission asks and decisions a home without inventing a task.

## Costs

- Work that should be tracked is lost unless someone makes the task.
- Activity is the one write that is not an event in the log, an exception to the Always rule, kept because it is presence, not a change to the board.
- Existing clients that read `PostMessageResult.task` must change; the field is gone.
