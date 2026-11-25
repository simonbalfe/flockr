import { mentionsIn } from "@flockr/contracts"
import { sql } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { channels, members, messages, reads, taskCommits, tasks } from "../db/schema"
import { mutate } from "../board/events"
import { seedChannels, seedClock, seedFeeds, seedMembers, seedTasks, unreadForSimon, type SeedReply } from "./data"

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export async function resetBoard(db: Database): Promise<void> {
  await db.execute(sql`truncate events, activity, reads, message_versions, messages, task_commits, tasks, channels, agents, machines, members, boards restart identity cascade`)
}

export async function seedBoard(db: Database, now = new Date()): Promise<boolean> {
  return mutate(db, async (tx, emit) => {
    const existing = await tx.select({ id: channels.id }).from(channels).limit(1)
    if (existing.length) return false
    const at = (clock: string) => new Date(now.getTime() - (minutesOf(seedClock) - minutesOf(clock)) * 60_000)

    for (const m of seedMembers) {
      await tx.insert(members).values({ name: m.name, kind: m.kind, owner: m.owner ?? null, runsIn: m.runsIn ?? null, source: m.source ?? null, createdAt: at("08:00") })
    }
    for (const [i, c] of seedChannels.entries()) await tx.insert(channels).values({ ...c, createdAt: new Date(at("08:00").getTime() + i) })

    for (const t of seedTasks) {
      await tx.insert(tasks).values({
        id: t.id,
        title: t.title,
        channel: t.channel,
        kind: t.kind,
        state: t.state,
        needs: t.needs ?? [],
        labels: [t.kind],
        assignee: t.assignee ?? null,
        holder: t.holder ?? null,
        leaseExpiresAt: t.leaseMinutes ? new Date(now.getTime() + t.leaseMinutes * 60_000) : null,
        claimEpoch: t.claimEpoch ?? 0,
        spec: t.spec ?? null,
        reason: t.reason ?? null,
        question: t.question ?? null,
        createdAt: at(t.at),
        updatedAt: at(t.at),
      })
      if (t.commit) await tx.insert(taskCommits).values({ taskId: t.id, sha: t.commit, addedBy: t.holder ?? "simon", addedAt: at(t.at) })
    }

    const names = new Set(seedMembers.map((m) => m.name))
    const mentions = (body: string) => mentionsIn(body, names)
    const replies: { parent: number; replies: SeedReply[]; channel: string }[] = []
    for (const [channel, feed] of Object.entries(seedFeeds)) {
      for (const item of feed) {
        const base = { channel, who: item.who, createdAt: at(item.at) }
        const values =
          item.kind === "text"
            ? { ...base, kind: item.kind, body: item.text, mentions: mentions(item.text), taskId: item.taskId ?? null }
            : item.kind === "event"
              ? { ...base, kind: item.kind, body: item.text }
              : { ...base, kind: item.kind, taskId: item.taskId }
        const [row] = await tx.insert(messages).values(values).returning({ id: messages.id })
        if (row && item.kind === "text" && item.replies) replies.push({ parent: row.id, replies: item.replies, channel })
      }
    }
    for (const thread of replies) {
      for (const [who, time, body] of thread.replies) {
        await tx.insert(messages).values({ channel: thread.channel, kind: "text", who, body, mentions: mentions(body), parentId: thread.parent, createdAt: at(time) })
      }
    }
    for (const t of seedTasks) {
      for (const [who, time, body] of t.replies ?? []) {
        await tx.insert(messages).values({ channel: t.channel, kind: "text", who, body, mentions: mentions(body), threadTaskId: t.id, createdAt: at(time) })
      }
    }

    await markSeedReads(tx)
    emit({ type: "board.seeded", actor: "simon", data: { channels: seedChannels.length, tasks: seedTasks.length } })
    return true
  })
}

async function markSeedReads(tx: Tx): Promise<void> {
  const rows = await tx.execute<{ channel: string; last: number }>(
    sql`select channel, max(id)::int as last from messages where parent_id is null and thread_task_id is null group by channel`,
  )
  for (const row of rows) {
    const lastReadId = unreadForSimon.includes(row.channel) ? 0 : row.last
    await tx.insert(reads).values({ member: "simon", channel: row.channel, lastReadId })
  }
}
