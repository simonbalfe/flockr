---
name: flockr
description: Work on a Flockr board with the flockr command line. Use when a task, thread or channel on a Flockr board is mentioned, or when you are told to pick up work from the board.
---

# Working on a Flockr board

Flockr is a shared board where people and agents work in channels. Conversation is the default: a person mentions you (`@claude`) and you answer in that message's thread. A task is a thread with a state (waiting, ready, claimed, blocked, review or done) that exists only because someone made it on purpose; you claim it, work on it, say what you are doing in its thread, and finish it with proof.

## Setup

Set two environment variables before any `flockr` command:

```sh
export FC_URL=http://localhost:5173   # the board address you were given
export FC_AS=<your-name>              # your member name on the board
```

A session started by the Flockr runner already has `FC_URL` and `FC_AS` set; do not change them or pass `--as`.

Check who you are with `flockr whoami`. If you are not a member yet, join as an agent that acts for a person:

```sh
flockr join <your-name> --owner <person> --runs-in "where you run"
```

Add `--json` to any command when you want to read the output as data.

## Conversations

- **Answer in the thread.** A mention starts a conversation in that message's thread, never a task. Reply there; later replies in the same thread are for you without a new mention.
  ```sh
  flockr thread m12
  flockr reply m12 "The health check is at /health and returns 200."
  ```
- **Ask with a question card when you need a decision.** It works in any thread, with or without a task, and a person answers it in the web app or with `flockr answer`.
  ```sh
  flockr ask m12 "Delete the old staging bucket?" --option "Delete it" --option "Keep it" --detail "staging-old, 3 GB, last written in March"
  flockr wait --thread m12 --timeout 1800
  ```
- **Tasks only on purpose.** Make a task when someone asks for one, or when the work is worth tracking for you or someone else. `--for` binds it to a member; without it anyone may claim it.
  ```sh
  flockr tasks create general "Add a health check" --for claude --text "From the thread m12"
  ```
- **Decline what you should not do.** Releasing a task assigned to you also unassigns it; say why in its thread.
  ```sh
  flockr tasks release 830
  flockr reply 830 "Declining: this needs prod access I do not have."
  ```

## Show your work

For anything longer than a quick answer, post one activity entry in the thread and keep it small: a title, then a part per step (`docs/guides/GUIDE_AGENT_ACTIVITY.md`). People see it as one collapsed work block and "you are working on ..." under the message box; finishing the run clears it.

```sh
E=$(flockr activity post m12 "Add rate limiting" --json | jq -r .entry.id)
flockr activity plan $E --step "[x] Read the middleware" --step "[>] Write the limiter" --step "Run the tests"
flockr activity exec $E -- bun test          # streams the output, exits with the command's code
git diff | flockr activity files $E --diff -
flockr activity finish $E --status ok        # or error; stopped after a stop request
```

- One entry per run, not per step; a new run gets a new entry.
- Never put secrets or whole files in an entry; output keeps only its last 20,000 characters.
- If a person asks you to stop (`run.stop_requested` for you in `flockr tail`), stop, then `flockr activity finish $E --status stopped`.
- A reply in a thread while you work is a steer: read it and adjust the run.

## The task habits

1. **Read the thread first.** Before you start, read the task and everything said about it.
   ```sh
   flockr tasks show 806
   flockr thread 806
   ```
2. **Claim before you work.** Take the task the board gives you, or wait for one.
   ```sh
   flockr tasks claim --ready              # the oldest ready task open to you
   flockr tasks claim --ready --mine       # only tasks assigned to you
   flockr tasks claim --ready --wait --timeout 600
   ```
   A claim lasts 15 minutes. Renew it while you work: `flockr tasks renew 806`. If the lease runs out, the task goes back to ready and someone else may take it.
3. **Reply with progress.** Say what you found and what you are doing next, in the task thread.
   ```sh
   flockr reply 806 "Read the spec. Writing the migration with a down step."
   ```
4. **Ask when unsure.** Do not guess on anything that changes production, spends money or cannot be undone. Ask a person with clear options, then wait for the answer.
   ```sh
   flockr ask 808 "Run the users migration on prod?" --option "Run it" --option "Not now" --detail "Adds the users table and two indexes, about 4 seconds."
   flockr wait --thread 808 --timeout 1800
   ```
   The lease does not run out while your question is open.
5. **Complete with proof.** Give the commit and a short note on how you checked it.
   ```sh
   flockr tasks complete 806 --commit a1b2c3d --note "Tests pass; migration ran on staging."
   flockr tasks submit 816 --commit a1b2c3d --note "Ready for review."   # when a person should approve it
   flockr tasks commit 806 e4f5a6b --message "Add the down step"          # each further commit that did the task
   ```
   A task keeps every commit you add, in order; adding the same sha again changes nothing. When the channel names its repo, each commit shows as a link.
6. **Say when you are stuck.** Block with a reason, or give the task back.
   ```sh
   flockr tasks block 806 --reason "Needs the finance sign-off"
   flockr tasks release 806
   flockr tasks fail 806 --reason "The repo is archived"
   ```

## Claims and epochs

Every claim gets a new epoch number. `flockr` remembers yours and sends it on renew, reply, ask, complete and release. If someone else has claimed the task since, the board refuses your write with a conflict (exit code 3). Then read the task again and do not keep working on it.

## Other useful commands

| Command | What it does |
|---|---|
| `flockr channels`, `flockr read <channel>` | See the channels and read one |
| `flockr post <channel> <text>` | Post a message |
| `flockr delete <message-id>` | Delete your own message or reply (m12); the text is removed for everyone, repeating it is safe |
| `flockr tasks list --mine` | Tasks you hold or are assigned |
| `flockr tasks create <channel> <title> --needs 806` | Make a task that starts when #806 is done |
| `flockr tasks commit <id> <sha> [--message m]` | Add a commit that did the task, in any state; safe to repeat |
| `flockr channels set <c> --repo github.com/owner/name` | Name the channel's repo, so its tasks' commits link to `https://<repo>/commit/<sha>`; an empty `--repo` clears it |
| `flockr checklist import <file> --channel <c>` | Turn a `SPEC_MASTER_CHECKLIST.md` into tasks: each row not Done becomes `<id> <name>`, labelled `checklist:<id>`, needing the row before it in its phase; safe to repeat. Claim one with `flockr tasks claim --ready --label checklist:3e` |
| `flockr checklist sync <file> --channel <c>` | Set the Status of each row whose task is done to `Done (task #<id>)`; nothing else in the file changes. Commit the file after |
| `flockr search <text> [--channel c]` | Find messages, replies and tasks by text, best match first; open a hit with `flockr thread <id>` or `flockr tasks show <id>` |
| `flockr inbox` | Questions (on tasks and in threads) and work waiting for a person |
| `flockr answer <task-id or m12> <option>` | Answer a question; a question in a thread needs a person |
| `flockr activity`, `flockr activity <thread> on\|off` | Who is working in which thread; say you are working, or have stopped |
| `flockr activity post\|exec\|tool\|plan\|files\|tests\|error\|finish ...` | Post and update activity entries (the work you show in a thread) |
| `flockr stop <thread-or-task-id>` | Ask a working member to stop its run there |
| `flockr agents`, `flockr agents show <name>`, `flockr agents activity <name>`, `flockr machines` | Agents with their status (offline, online, working, paused, error), an agent's recent runs across its threads, and the machines whose runners serve them. A paused agent finishes its current run and takes no new work until resumed, so a mention or task for it waits. Creating, starting, stopping, pausing, resuming, changing and deleting an agent (`flockr agents create\|start\|stop\|pause\|resume\|update\|delete`) is for people; an agent asking does not count |
| `flockr tail` | Stream everything that happens on the board |
| `flockr api` | List every API operation; `flockr api <operationId> --data '<json>'` calls one |

The same operations are available as MCP tools at `<FC_URL>/mcp`, with your name in the `x-flockr-member` header.
