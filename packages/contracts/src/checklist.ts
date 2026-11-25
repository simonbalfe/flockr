import type { taskStates } from "./constants"

export const checklistLabel = "checklist"
export const checklistSkipReasons = ["done", "exists"] as const
export type ChecklistSkipReason = (typeof checklistSkipReasons)[number]
export const checklistLimits = { markdownChars: 500_000 } as const

const rowLabelPrefix = `${checklistLabel}:`

export const checklistRowLabel = (id: string) => `${rowLabelPrefix}${id}`
export const checklistRowOf = (label: string): string | null => (label.startsWith(rowLabelPrefix) ? label.slice(rowLabelPrefix.length) || null : null)
export const checklistTitle = (row: { id: string; name: string }) => `${row.id} ${row.name}`
export const tickedStatus = (taskId: number) => `Done (task #${taskId})`

export interface Span {
  start: number
  end: number
}

export interface ChecklistRow {
  id: string
  name: string
  phase: number
  delivers: string
  status: string
  done: boolean
  statusSpan: Span
}

interface Cell {
  text: string
  span: Span
}

const phaseHeading = /^##\s+Phase\s+(\d+)\b/i
const sectionHeading = /^#{1,2}\s/
const fence = /^(```|~~~)/
const rowName = /^(\d+[a-z]+)\s+(.+)$/
const donePattern = /^done\b/i

function cellsOf(line: string, offset: number): Cell[] | null {
  const lead = line.length - line.trimStart().length
  if (line[lead] !== "|") return null
  const pipes: number[] = []
  for (let i = lead; i < line.length; i++) {
    if (line[i] === "\\") i++
    else if (line[i] === "|") pipes.push(i)
  }
  const bounds = pipes.map((p, i) => ({ from: p + 1, to: pipes[i + 1] ?? line.length }))
  const last = bounds.at(-1)
  if (last && !line.slice(last.from).trim()) bounds.pop()
  return bounds.map(({ from, to }) => {
    const raw = line.slice(from, to)
    const text = raw.trim()
    const start = offset + from + (raw.length - raw.trimStart().length)
    return { text, span: { start, end: start + text.length } }
  })
}

interface Columns {
  delivers: number
  status: number | null
}

function headerColumns(cells: Cell[]): Columns | null {
  const names = cells.map((c) => c.text.toLowerCase())
  const status = names.indexOf("status")
  if (status < 0) return null
  const delivers = names.indexOf("delivers")
  return { delivers: delivers < 0 ? 2 : delivers, status }
}

export function parseChecklist(markdown: string): ChecklistRow[] {
  const rows: ChecklistRow[] = []
  let phase: number | null = null
  let fenced = false
  let columns: Columns = { delivers: 2, status: null }
  let offset = 0
  for (const line of markdown.split("\n")) {
    const lineStart = offset
    offset += line.length + 1
    const trimmed = line.trim()
    if (fence.test(trimmed)) fenced = !fenced
    if (fenced) continue
    if (sectionHeading.test(trimmed)) {
      const match = phaseHeading.exec(trimmed)
      phase = match?.[1] ? Number(match[1]) : null
      columns = { delivers: 2, status: null }
      continue
    }
    if (phase === null) continue
    const cells = cellsOf(line, lineStart)
    if (!cells?.length) continue
    const [first] = cells
    const named = first ? rowName.exec(first.text) : null
    if (!named?.[1] || !named[2]) {
      columns = headerColumns(cells) ?? columns
      continue
    }
    const status = cells[columns.status ?? cells.length - 1]
    if (!status || cells.length < 2) continue
    rows.push({
      id: named[1],
      name: named[2].trim(),
      phase,
      delivers: cells[columns.delivers]?.text ?? "",
      status: status.text,
      done: donePattern.test(status.text),
      statusSpan: status.span,
    })
  }
  return rows
}

export interface ChecklistTask {
  id: number
  state: (typeof taskStates)[number]
  labels: string[]
}

export function doneTasksByRow(tasks: ChecklistTask[]): Map<string, number> {
  const done = new Map<string, number>()
  for (const task of tasks) {
    if (task.state !== "done") continue
    for (const label of task.labels) {
      const row = checklistRowOf(label)
      if (row && !done.has(row)) done.set(row, task.id)
    }
  }
  return done
}

export interface Ticked {
  row: string
  taskId: number
}

export function tickChecklist(markdown: string, doneByRow: ReadonlyMap<string, number>): { markdown: string; ticked: Ticked[] } {
  const edits = parseChecklist(markdown).flatMap((row) => {
    const taskId = doneByRow.get(row.id)
    return taskId === undefined || row.done ? [] : [{ row: row.id, taskId, span: row.statusSpan }]
  })
  let result = markdown
  for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    result = `${result.slice(0, edit.span.start)}${tickedStatus(edit.taskId)}${result.slice(edit.span.end)}`
  }
  return { markdown: result, ticked: edits.map(({ row, taskId }) => ({ row, taskId })) }
}
