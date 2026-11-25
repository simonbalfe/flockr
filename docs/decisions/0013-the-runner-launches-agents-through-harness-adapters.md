# 0013: The runner launches agents through harness adapters

Status: accepted, 24 Nov 2026; the one-member config (member, harness, channel folders) superseded by 0016. Builds on 0007 (sandbox runtime is agnostic), 0009 (nothing names a provider outside its adapter) and 0010 (one contract). Decided by Simon in chat.

## Problem

Simon wants to talk to Claude Code from the Flockr web app. The board cannot reach his Mac, and the agent needs his files, his logged-in Claude plan and a way to ask before it runs anything risky. Whatever starts it must not tie the board to one harness.

## Options

| Option | Good | Cost |
|---|---|---|
| The server spawns the agent | No extra program | The server would run on the Mac with the agent's rights, and would name a harness |
| A Herdr pane per task (`hc run`) | Simon can watch the pane | Needs Herdr; no clean way to resume one conversation per thread or to route permission asks to the board |
| A runner on the Mac that connects out as one member and starts a headless harness session through an adapter | A client like `fc`; resume per thread; permissions become question cards; any harness is one adapter | One more long-running program to start |

## Choice

`apps/runner` (`bun run runner`) is a Bun program on the Mac. It reads `~/.flockr/runner.json` (path overridable with `FLOCKR_RUNNER_CONFIG`, decoded with Zod): the board URL, the member it acts as, the harness name, one folder per channel, `maxSessions` and `maxMinutes`. A channel with no folder gets one reply saying so and no session.

- **Harness interface** (`apps/runner/src/harness/types.ts`): start a session for a thread with a prompt and a folder, send a follow-up into it, stop it, report status, and declare capabilities (`resume`, `streaming`). `harnessFor(name)` picks the adapter; `claude-code.ts` is the first and the only file that names Claude Code.
- **Sessions:** one per thread, stored in `~/.flockr/runner-sessions.json`, resumed on every later reply. The last event seen is kept in `~/.flockr/runner-state.json`, so a restart catches up.
- **Activity and stopping:** each run posts an activity entry in its thread when it starts and finishes it when it ends; a `run.stop_requested` for its member in that thread stops the run.
- **Tasks:** a ready task assigned to the member is claimed (only tasks assigned to it), renewed every 5 minutes, stopped when a person takes it away or after `maxMinutes` (then released and unassigned, with a reply saying why), submitted for review when the run ends, blocked when it crashes. Ctrl-C stops every session and releases its claims, keeping the assignment.
- **Permissions (Simon's decision): edits are free, other commands ask.** File reads and edits (Read, Glob, Grep, Edit, Write, NotebookEdit) run without asking. Every other tool call goes through Claude Code's headless permission delegation (`--permission-prompt-tool`) to a small stdio MCP server the runner ships (`apps/runner/src/bridge.ts`). It allows `fc` (without `--as` or `--url`), `git status`, `git diff`, `git log` and `ls`, and anything else, including anything that chains or substitutes shell commands, becomes a question card in the thread: "Run `date`? Allow once / Deny", with the exact tool and input as the detail. The session waits for a person's answer. `--dangerously-skip-permissions` is never used.
- **Claude Code flags:** `-p --input-format stream-json --output-format stream-json --verbose` (headless, follow-ups go into the live session), `--permission-mode manual` (Simon's user settings default to bypassing permissions, so the mode is set explicitly), `--setting-sources project,local` (user settings, their allow rules and hooks do not apply), `--allowedTools Read,Glob,Grep,Edit,Write,NotebookEdit`, `--strict-mcp-config --mcp-config <bridge>`, `--permission-prompt-tool mcp__flockr__approve`, `--append-system-prompt <runner rules and the board skill>`, `--name flockr <thread>`, and `--session-id <uuid>` for a new thread or `--resume <id>` for a known one. The installed version's `--help` does not list `--permission-prompt-tool`; the binary accepts it and documents its rules (it must be an MCP tool).
- **Plan, not API key:** headless runs use the Claude plan Simon is logged in with. The session environment holds only `FC_URL`, `FC_AS`, `FC_STATE`, `PATH` (with an `fc` shim first) and what Claude Code needs (`HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, `CLAUDE_CONFIG_DIR`). No API key is passed, so the run cannot switch to paid API billing.

## Why

The runner is just another client of the API, so the board stays agnostic and every surface keeps working. Question cards put the risky step in front of a person where they already look, on the phone too.

## Costs

- One more program to start and keep running; nothing runs while it is off.
- Edits are not limited to the channel folder: a free Edit can touch any file the Mac user can.
- A permission ask holds a thread's one open question; if a run is stopped while it waits, the question stays open until a person answers it, and the next ask in that thread is refused until then.
- With no sign-in yet (ADR 0010), the board cannot tell the runner's member from someone using its name; the bridge refuses `fc --as`, and a thread question can only be answered by a person, but a determined process on the Mac could still act as anyone.
- Dropping user settings also drops Simon's model choice and hooks for these sessions.
