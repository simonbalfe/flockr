import { searchLimits, type MessageHit, type SearchHit, type SearchQuery, type SearchResult, type SnippetPart, type TaskHit } from "@flockr/contracts"
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { Executor } from "../db/client"
import { messageSearchVector, messages, taskSearchVector, tasks } from "../db/schema"
import { messageKey, requireChannel, threadKeyOf } from "./read"
import { visibleTo, type Viewer } from "./visibility"

const startMark = "\u0002"
const stopMark = "\u0003"
const headlineOptions = `StartSel=${startMark}, StopSel=${stopMark}, MaxWords=${searchLimits.snippetWords}, MinWords=12, ShortWord=2`

export function searchQuery(text: string): SQL | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const last = words.pop()
  if (last === undefined) return null
  const typing = sql`(to_tsquery('english', ${`${last}:*`}) || to_tsquery('simple', ${`${last}:*`}))`
  return words.length ? sql`(to_tsquery('english', ${words.join(" & ")}) && ${typing})` : typing
}

export function snippetParts(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  const push = (text: string, match: boolean) => {
    if (text) parts.push({ text, match })
  }
  headline.split(startMark).forEach((piece, i) => {
    if (i === 0) return push(piece, false)
    const end = piece.indexOf(stopMark)
    if (end < 0) return push(piece, true)
    push(piece.slice(0, end), true)
    push(piece.slice(end + 1), false)
  })
  return parts
}

interface Search {
  query: SQL
  phrase: string
  channel: string | undefined
  limit: number
  viewer: Viewer
}

const phraseBonus = (phrase: string, text: SQL) => sql`case when position(${phrase} in lower(${text})) > 0 then 1 else 0 end`

async function messageHits(db: Executor, search: Search): Promise<MessageHit[]> {
  const vector = messageSearchVector(messages.body)
  const rank = sql<number>`(ts_rank_cd(${vector}, ${search.query}, 32) + ${phraseBonus(search.phrase, sql`${messages.body}`)})::float8`
  const rows = await db
    .select({ row: messages, rank, headline: sql<string>`ts_headline('english', ${messages.body}, ${search.query}, ${headlineOptions})` })
    .from(messages)
    .where(
      and(
        sql`${messages.kind} = 'text'`,
        isNull(messages.deletedAt),
        visibleTo(messages.channel, search.viewer),
        sql`${vector} @@ ${search.query}`,
        search.channel === undefined ? undefined : eq(messages.channel, search.channel),
      ),
    )
    .orderBy(desc(rank), desc(messages.id))
    .limit(search.limit)
  return rows.map(({ row, rank, headline }) => ({
    kind: "message",
    id: messageKey(row.id),
    channel: row.channel,
    threadId: threadKeyOf(row),
    taskId: row.threadTaskId,
    who: row.who,
    at: row.createdAt.toISOString(),
    snippet: snippetParts(headline),
    rank,
  }))
}

async function taskHits(db: Executor, search: Search): Promise<TaskHit[]> {
  const vector = taskSearchVector(tasks.title, tasks.spec)
  const text = sql`${tasks.title} || coalesce(': ' || ${tasks.spec}, '')`
  const rank = sql<number>`(ts_rank_cd(${vector}, ${search.query}, 32) + ${phraseBonus(search.phrase, text)})::float8`
  const rows = await db
    .select({
      row: tasks,
      rank,
      headline: sql<string>`ts_headline('english', ${text}, ${search.query}, ${headlineOptions})`,
      who: sql<string | null>`(select m.who from messages m where m.task_id = "tasks"."id" and m.kind = 'task' order by m.id limit 1)`,
    })
    .from(tasks)
    .where(and(sql`${vector} @@ ${search.query}`, visibleTo(tasks.channel, search.viewer), search.channel === undefined ? undefined : eq(tasks.channel, search.channel)))
    .orderBy(desc(rank), desc(tasks.id))
    .limit(search.limit)
  return rows.map(({ row, rank, headline, who }) => ({
    kind: "task",
    id: row.id,
    channel: row.channel,
    title: row.title,
    state: row.state,
    who,
    at: row.createdAt.toISOString(),
    snippet: snippetParts(headline),
    rank,
  }))
}

const byRank = (a: SearchHit, b: SearchHit) => b.rank - a.rank || Date.parse(b.at) - Date.parse(a.at)

export async function searchBoard(db: Executor, input: SearchQuery, viewer: Viewer): Promise<SearchResult> {
  if (input.channel !== undefined) await requireChannel(db, input.channel)
  const query = searchQuery(input.q)
  if (query === null) return { query: input.q, hits: [] }
  const search: Search = {
    query,
    phrase: input.q.toLowerCase().replace(/\s+/g, " "),
    channel: input.channel,
    limit: input.limit,
    viewer,
  }
  const [found, made] = await Promise.all([messageHits(db, search), taskHits(db, search)])
  return { query: input.q, hits: [...found, ...made].sort(byRank).slice(0, input.limit) }
}
