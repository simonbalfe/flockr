import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Channel, EventPage, Task, Thread } from "@flockr/contracts"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { z } from "zod"
import { testDatabaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { migrationsFolder } from "../src/db/migrate"
import { freshBoard } from "./harness"

const Journal = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })

async function commitEvents(call: Awaited<ReturnType<typeof freshBoard>>["call"], taskId: number) {
  const page = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1000")).json)
  return page.events.filter((e) => e.type === "task.commit_added" && e.taskId === taskId)
}

function foldersUpTo(lastTag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "flockr-migrations-"))
  mkdirSync(path.join(folder, "meta"))
  const journal = Journal.parse(JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")))
  const end = journal.entries.findIndex((e) => e.tag === lastTag)
  const entries = journal.entries.slice(0, end + 1)
  for (const entry of entries) copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`))
  writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }))
  return folder
}

async function scratchDatabase(): Promise<string> {
  const url = new URL(testDatabaseUrl)
  const name = `${url.pathname.slice(1)}_migrate`
  const admin = new URL(testDatabaseUrl)
  admin.pathname = "/postgres"
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => undefined })
  await sql.unsafe(`drop database if exists "${name}" with (force)`)
  await sql.unsafe(`create database "${name}"`)
  await sql.end()
  url.pathname = `/${name}`
  return url.toString()
}

describe("task commits", () => {
  test("a task keeps several commits in the order they were added", async () => {
    const { call } = await freshBoard()
    const claimed = Task.parse((await call("claude", "POST", "/api/tasks/806/claim")).json)
    expect((await call("claude", "POST", "/api/tasks/806/commits", { sha: "1111111aaaa", message: "Add the users table", epoch: claimed.claimEpoch })).status).toBe(200)
    expect((await call("claude", "POST", "/api/tasks/806/commits", { sha: "2222222bbbb", epoch: claimed.claimEpoch })).status).toBe(200)
    const done = Task.parse((await call("claude", "POST", "/api/tasks/806/complete", { epoch: claimed.claimEpoch, commit: "3333333cccc" })).json)
    expect(done.state).toBe("done")
    expect(done.commits.map((c) => [c.short, c.message, c.addedBy])).toEqual([
      ["1111111", "Add the users table", "claude"],
      ["2222222", null, "claude"],
      ["3333333", null, "claude"],
    ])
    expect((await commitEvents(call, 806)).map((e) => e.data.sha)).toEqual(["1111111aaaa", "2222222bbbb", "3333333cccc"])
    const thread = Thread.parse((await call("simon", "GET", "/api/threads/806")).json)
    expect(thread.entries.filter((e) => e.kind === "event" && e.text.startsWith("added commit")).map((e) => (e.kind === "event" ? e.text : ""))).toEqual([
      "added commit `1111111`: Add the users table",
      "added commit `2222222`",
      "added commit `3333333`",
    ])
  })

  test("adding a sha the task already has changes nothing", async () => {
    const { call } = await freshBoard()
    const first = Task.parse((await call("tim", "POST", "/api/tasks/818/commits", { sha: "C0FFEE1" })).json)
    const again = await call("tim", "POST", "/api/tasks/818/commits", { sha: " c0ffee1 ", message: "Different words" })
    expect(again.status).toBe(200)
    expect(Task.parse(again.json).commits).toEqual(first.commits)
    expect(first.commits.map((c) => c.sha)).toEqual(["b41e7c2", "c0ffee1"])
    expect(await commitEvents(call, 818)).toHaveLength(1)
    const thread = Thread.parse((await call("simon", "GET", "/api/threads/818")).json)
    expect(thread.entries.filter((e) => e.kind === "event" && e.text.includes("c0ffee1"))).toHaveLength(1)
    expect((await call("tim", "POST", "/api/tasks/818/commits", { sha: "not-a-sha" })).status).toBe(400)
  })

  test("a commit links to the channel's repo, and is plain without one", async () => {
    const { call } = await freshBoard()
    const plain = Task.parse((await call("simon", "GET", "/api/tasks/818")).json)
    expect(plain.commits[0]).toMatchObject({ sha: "b41e7c2", url: "https://github.com/example-org/platform/commit/b41e7c2" })
    expect((await call("simon", "PATCH", "/api/channels/platform", { repo: "https://github.com/x/y" })).status).toBe(400)
    const moved = Channel.parse((await call("simon", "PATCH", "/api/channels/platform", { repo: "gitlab.com/example-org/platform-v2" })).json)
    expect(moved.repo).toBe("gitlab.com/example-org/platform-v2")
    const relinked = Task.parse((await call("simon", "GET", "/api/tasks/818")).json)
    expect(relinked.commits[0]?.url).toBe("https://gitlab.com/example-org/platform-v2/commit/b41e7c2")
    expect(Channel.parse((await call("simon", "PATCH", "/api/channels/platform", { repo: null })).json).repo).toBeNull()
    const cleared = Task.parse((await call("simon", "GET", "/api/tasks/818")).json)
    expect(cleared.commits[0]).toMatchObject({ short: "b41e7c2", url: null })
    const made = Channel.parse((await call("simon", "POST", "/api/channels", { id: "site", repo: "github.com/example-org/site" })).json)
    expect(made.repo).toBe("github.com/example-org/site")
  })

  test("a task's old single commit moves into its commits when the migration runs", async () => {
    const url = await scratchDatabase()
    const folder = foldersUpTo("0006_search")
    const connection = connect(url, 2)
    try {
      await migrate(connection.db, { migrationsFolder: folder })
      await connection.sql`insert into members (name, kind) values ('claude', 'agent')`
      await connection.sql`insert into channels (id) values ('backend')`
      await connection.sql`insert into tasks (id, title, channel, state, holder, commit) values (900, 'Done by claude', 'backend', 'done', 'claude', 'ABCDEF1'), (902, 'Never held', 'backend', 'done', null, 'abc1234'), (904, 'No commit', 'backend', 'ready', null, null)`
      await migrate(connection.db, { migrationsFolder })
      const rows = await connection.sql`select task_id, sha, added_by from task_commits order by id`
      expect(rows.map((r) => [r.task_id, r.sha, r.added_by])).toEqual([
        [900, "abcdef1", "claude"],
        [902, "abc1234", "flockr"],
      ])
      const columns = await connection.sql`select column_name from information_schema.columns where table_name = 'tasks' and column_name = 'commit'`
      expect(columns).toHaveLength(0)
    } finally {
      await connection.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
