import { describe, expect, test } from "bun:test"
import { ChecklistImport, doneTasksByRow, parseChecklist, Task, tickChecklist } from "@flockr/contracts"
import { z } from "zod"
import { freshBoard } from "./harness"

const fixture = await Bun.file(new URL("./fixtures/SPEC_MASTER_CHECKLIST.md", import.meta.url)).text()
const doneInFixture = ["1c", "1e", "2a", "2c", "2d", "2e", "3a", "3b"]

async function roadmap() {
  const board = await freshBoard()
  expect((await board.call("simon", "POST", "/api/channels", { id: "roadmap" })).status).toBe(200)
  const importFile = async (markdown: string) => {
    const response = await board.call("simon", "POST", "/api/channels/roadmap/checklist", { markdown })
    expect(response.status).toBe(200)
    return ChecklistImport.parse(response.json)
  }
  const tasks = async () => z.array(Task).parse((await board.call("simon", "GET", "/api/tasks?channel=roadmap")).json)
  const finish = async (id: number) => {
    const claimed = Task.parse((await board.call("claude", "POST", `/api/tasks/${id}/claim`)).json)
    expect((await board.call("claude", "POST", `/api/tasks/${id}/complete`, { epoch: claimed.claimEpoch })).status).toBe(200)
  }
  return { ...board, importFile, tasks, finish }
}

describe("checklist import", () => {
  test("parses every sub-phase row of the master checklist with its phase, delivers and status", () => {
    const rows = parseChecklist(fixture)
    expect(rows.map((r) => r.id)).toEqual([
      ...["1a", "1b", "1c", "1d", "1e"],
      ...["2a", "2b", "2c", "2d", "2e", "2f"],
      ...["3a", "3b", "3c", "3d", "3e"],
      ...["4a", "4b", "4c", "4d"],
      ...["5a", "5b", "5c", "5d", "5e"],
      ...["6a", "6b", "6c"],
    ])
    expect(rows.filter((r) => r.done).map((r) => r.id)).toEqual(doneInFixture)
    const row = rows.find((r) => r.id === "3e")
    expect(row).toMatchObject({
      name: "Checklist import",
      phase: 3,
      delivers: "A repo's `SPEC_MASTER_CHECKLIST.md` rows become tasks with their order; completing a task ticks its row",
      status: "Not started",
      done: false,
    })
    expect(row && fixture.slice(row.statusSpan.start, row.statusSpan.end)).toBe("Not started")
  })

  test("each imported task needs the one before it in its phase, and finishing it readies the next", async () => {
    const { importFile, tasks, finish } = await roadmap()
    const result = await importFile(fixture)
    expect(result.created).toHaveLength(28 - doneInFixture.length)
    expect(result.skipped).toEqual(doneInFixture.map((row) => expect.objectContaining({ row, reason: "done", taskId: null })))
    const byTitle = new Map(result.created.map((t) => [t.title.split(" ")[0], t]))
    const task = (row: string) => {
      const found = byTitle.get(row)
      if (!found) throw new Error(`No task for ${row}`)
      return found
    }
    expect(task("1a")).toMatchObject({ title: "1a Skeleton", state: "ready", needs: [], labels: ["checklist", "checklist:1a"] })
    expect(task("1b")).toMatchObject({ state: "waiting", needs: [task("1a").id] })
    expect(task("1d")).toMatchObject({ state: "waiting", needs: [task("1b").id] })
    expect(task("2b")).toMatchObject({ state: "ready", needs: [] })
    expect(task("2f")).toMatchObject({ state: "waiting", needs: [task("2b").id] })
    expect(task("3c")).toMatchObject({ state: "ready", needs: [] })
    expect(task("3e")).toMatchObject({ state: "waiting", needs: [task("3d").id], spec: expect.stringContaining("completing a task ticks its row") })
    await finish(task("1a").id)
    const after = await tasks()
    expect(after.find((t) => t.id === task("1b").id)?.state).toBe("ready")
    expect(after.find((t) => t.id === task("1d").id)?.state).toBe("waiting")
  })

  test("re-importing skips rows that already have a task, and a new row needs the existing task before it", async () => {
    const { importFile, tasks } = await roadmap()
    const [first, second] = await Promise.all([importFile(fixture), importFile(fixture)])
    expect([first?.created.length, second?.created.length].sort()).toEqual([0, 20])
    const all = await tasks()
    expect(all).toHaveLength(20)
    const again = await importFile(fixture)
    expect(again.created).toHaveLength(0)
    expect(again.skipped.filter((s) => s.reason === "exists").map((s) => s.taskId)).toEqual(all.map((t) => t.id))
    const grown = fixture.replace("| 3e Checklist import |", "| 3f Checklist export | both | Write it back | Our own | Not started |\n| 3e Checklist import |")
    const added = await importFile(grown)
    expect(added.created).toEqual([expect.objectContaining({ title: "3f Checklist export", needs: [all.find((t) => t.title === "3d Commit links")?.id] })])
    expect(await tasks()).toHaveLength(21)
  })

  test("sync rewrites only the Status cells of rows whose task is done", async () => {
    const { importFile, tasks, finish } = await roadmap()
    const result = await importFile(fixture)
    const oneA = result.created.find((t) => t.title === "1a Skeleton")
    const threeC = result.created.find((t) => t.title === "3c Agent keys")
    if (!oneA || !threeC) throw new Error("Import missed 1a or 3c")
    await finish(oneA.id)
    await finish(threeC.id)
    const synced = tickChecklist(fixture, doneTasksByRow(await tasks()))
    expect(synced.ticked).toEqual([
      { row: "1a", taskId: oneA.id },
      { row: "3c", taskId: threeC.id },
    ])
    const rows = parseChecklist(fixture)
    const cell = (id: string) => rows.find((r) => r.id === id)?.statusSpan ?? { start: 0, end: 0 }
    const expected =
      fixture.slice(0, cell("1a").start) +
      `Done (task #${oneA.id})` +
      fixture.slice(cell("1a").end, cell("3c").start) +
      `Done (task #${threeC.id})` +
      fixture.slice(cell("3c").end)
    expect(synced.markdown).toBe(expected)
    expect(parseChecklist(synced.markdown).find((r) => r.id === "1a")).toMatchObject({ status: `Done (task #${oneA.id})`, done: true })
    expect(tickChecklist(synced.markdown, doneTasksByRow(await tasks())).markdown).toBe(synced.markdown)
  })
})
