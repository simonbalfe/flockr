# 3d Commit links

A task stores the commits that did it, and the thread links to each. This also closes 2b's "commit as a link".

## Scope

- **Several commits per task.** A new table `task_commits` (id, task id, sha, optional message, added by, added at; unique on task and sha) replaces the one `tasks.commit` column, which migration `0007_task_commits` copies into the table (lowercased, added by the task's holder, else its assignee, else `flockr`, at the task's `updated_at`) and then drops. `Task.commit` is gone from the API; `Task.commits` lists `{ sha, short, message, url, addedBy, addedAt }`, oldest first.
- **Adding a commit** is one shared write, `recordCommit` in `apps/server/src/board/commits.ts`: insert with `on conflict do nothing`, and only when a row was made, a thread event (``added commit `a1b2c3d`: subject``) and a `task.commit_added` event, all in the caller's transaction. Adding the same sha twice changes nothing and writes no event. It works in any state, so a person can link a commit after the task is done; an epoch, when sent, must be current.
- **`complete` and `submit` with a commit** add it to the list through the same write. Submit's default note names the newest commit when none is sent.
- **A repo per channel.** `channels.repo`, nullable, shaped `host/path` with no scheme (`github.com/simonbalfe/flockr`), checked by the `Repo` schema in `packages/contracts/src/commits.ts`. Set it at create or with `PATCH /api/channels/{channel}`; `null` clears it. A change writes `channel.updated`.
- **Links.** The server builds each commit's `url` with `commitUrl(repo, sha)` (`https://<repo>/commit/<sha>`) when the task's channel has a repo, else `null`, so every surface shows the same link and a repo change relinks old commits at once.
- **Sha shape.** `Sha` is 7 to 64 hex characters, trimmed and lowercased; `short` is the first 7.

Out: checking that a sha exists in the repo, pull requests and branches, matching a short sha to a longer one already on the task (they are two rows), hosts whose commit path is not `/commit/<sha>`.

## Surfaces

| Surface | What |
|---|---|
| API | `POST /api/tasks/{id}/commits` (`addTaskCommit`), `PATCH /api/channels/{channel}` (`updateChannel`), `repo` on `createChannel`; `commit` on `completeTask` and `submitForReview` adds to the list |
| MCP | `addTaskCommit`, `updateChannel`, generated from the same document |
| CLI | `flockr tasks commit <id> <sha> [--message m]`; `flockr channels create <id> [--repo r]`; `flockr channels set <id> [--topic t] [--repo r]` (an empty `--repo` clears it). `tasks show` prints each commit with its link; `--json` carries `commits` |
| Web | The task panel's Commits row shows each short sha, linked when the channel has a repo; inline code in the task's thread that matches one of its commits links too; "Add commit" beside the task actions; "Set repo" (or the repo's name) in the channel header opens a dialog to set or remove it |

## Rules the tests hold (`apps/server/test/commits.test.ts`)

- Several commits per task stay in the order they were added, each with one thread event and one `task.commit_added`.
- The same sha twice (any case or spacing) is a no-op: same list, one event.
- Old single-commit data migrates: a database at `0006_search` with `tasks.commit` set comes out of `0007` with those rows in `task_commits` and no `commit` column.
- The link is built from the channel repo, follows a repo change and is `null` once the repo is cleared; a repo with `https://` is refused.

## Exit checklist

- [x] Table and migration with the data copy; `bun run db:generate`
- [x] Routes, `bun run generate`, MCP tools
- [x] `flockr tasks commit`, `flockr channels create|set --repo`
- [x] Web: commit links in the task panel and thread, Add commit, channel repo dialog
- [x] Tests for the four rules; `bun run check` passes
- [x] Board skill, web README, architecture guide, master checklist rows 2b and 3d

## Notes from the build

- The old column is dropped rather than kept beside the table, so a commit has one home. The data copy is a hand-added `INSERT ... SELECT` between the generated `CREATE TABLE` and `DROP COLUMN` in the new migration, before it was ever applied.
- The url is computed on read, not stored: a channel's repo can be set after its tasks are done, and the links appear without touching the commits.
- The web links shas in thread text through a context the task panel provides (`commit-link.tsx`), so `rich-text` and `markdown` stay free of task lookups; only shas of that task link, so a random hex word in a reply stays plain.
- Repo dialog input strips a pasted `https://` and a trailing `.git` before saving; the API itself refuses a scheme so the stored form is one shape.
- The migration test builds a scratch database (`<test db>_migrate`) and a copy of the journal cut at `0006`, then runs the real folder on top: drizzle applies only the newer migrations.
- The "Set repo" button is hidden below the `sm` breakpoint, like Import checklist; `flockr channels set` covers phones and agents.
