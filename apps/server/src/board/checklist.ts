import { checklistLabel, checklistRowLabel, checklistRowOf, checklistTitle, parseChecklist, type ChecklistImport, type ChecklistSkip } from "@flockr/contracts"
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm"
import type { Database, Tx } from "../db/client"
import { channels, tasks } from "../db/schema"
import { invalid, notFound } from "./errors"
import { mutate } from "./events"
import { requireActor } from "./members"
import { presentTasks } from "./read"
import { insertTask } from "./tasks"

async function lockChannel(tx: Tx, channel: string): Promise<void> {
  const [row] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channel)).for("no key update")
  if (!row) throw notFound(`Channel ${channel} does not exist`)
}

async function checklistTasks(tx: Tx, channel: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: tasks.id, labels: tasks.labels })
    .from(tasks)
    .where(and(eq(tasks.channel, channel), arrayContains(tasks.labels, [checklistLabel])))
    .orderBy(asc(tasks.id))
  const byRow = new Map<string, number>()
  for (const row of rows) {
    for (const label of row.labels) {
      const id = checklistRowOf(label)
      if (id && !byRow.has(id)) byRow.set(id, row.id)
    }
  }
  return byRow
}

export async function importChecklist(db: Database, actor: string, channel: string, markdown: string): Promise<ChecklistImport> {
  const rows = parseChecklist(markdown)
  if (!rows.length) throw invalid("No checklist rows found: expected rows such as `| 1a Skeleton | both | Delivers | Covers | Status |` under `## Phase N: ...` headings")
  const result = await mutate(db, async (tx, emit) => {
    await requireActor(tx, actor)
    await lockChannel(tx, channel)
    const byRow = await checklistTasks(tx, channel)
    const lastInPhase = new Map<number, number>()
    const created: number[] = []
    const skipped: ChecklistSkip[] = []
    for (const row of rows) {
      const title = checklistTitle(row)
      const existing = byRow.get(row.id)
      if (existing !== undefined) {
        skipped.push({ row: row.id, title, reason: "exists", taskId: existing })
        lastInPhase.set(row.phase, existing)
        continue
      }
      if (row.done) {
        skipped.push({ row: row.id, title, reason: "done", taskId: null })
        continue
      }
      const before = lastInPhase.get(row.phase)
      const task = await insertTask(tx, emit, actor, {
        channel,
        title,
        assignee: null,
        needs: before === undefined ? [] : [before],
        labels: [checklistLabel, checklistRowLabel(row.id)],
        kind: "build",
        spec: row.delivers || null,
      })
      byRow.set(row.id, task.id)
      lastInPhase.set(row.phase, task.id)
      created.push(task.id)
    }
    if (created.length) emit({ type: "checklist.imported", actor, channel, data: { created, skipped: skipped.map((s) => s.row) } })
    return { created, skipped }
  })
  const created = result.created.length ? await db.select().from(tasks).where(inArray(tasks.id, result.created)).orderBy(asc(tasks.id)) : []
  return { created: await presentTasks(db, created), skipped: result.skipped }
}
