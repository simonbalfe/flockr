import * as sdk from "@flockr/client"
import { doneTasksByRow, tickChecklist, type ChecklistImport } from "@flockr/client"
import { run } from "./api"
import { need, UsageError } from "./args"
import type { CommandContext } from "./activity"
import { taskLine } from "./format"

async function readFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new UsageError(`No file ${path}`)
  return file.text()
}

function importText(result: ChecklistImport): string {
  const lines = [`Made ${result.created.length} task${result.created.length === 1 ? "" : "s"}, skipped ${result.skipped.length}.`]
  lines.push(...result.created.map(taskLine))
  lines.push(...result.skipped.map((s) => `  skipped ${s.title}: ${s.reason === "done" ? "Done in the file" : `already #${s.taskId}`}`))
  return lines.join("\n")
}

export async function checklistCommand(context: CommandContext): Promise<number> {
  const { positionals, values, print } = context
  const sub = positionals[1]
  const path = () => need(positionals[2], "checklist file")
  const channel = () => need(values.channel, "--channel <channel>").replace(/^#/, "")
  switch (sub) {
    case "import": {
      const markdown = await readFile(path())
      const result = await run(sdk.importChecklist({ path: { channel: channel() }, body: { markdown } }))
      print(result, () => importText(result))
      return 0
    }
    case "sync": {
      const file = path()
      const markdown = await readFile(file)
      const tasks = await run(sdk.listTasks({ query: { channel: channel() } }))
      const result = tickChecklist(markdown, doneTasksByRow(tasks))
      if (result.markdown !== markdown) await Bun.write(file, result.markdown)
      print({ file, ticked: result.ticked }, () =>
        result.ticked.length ? [`Ticked ${result.ticked.length} row${result.ticked.length === 1 ? "" : "s"} in ${file}:`, ...result.ticked.map((t) => `  ${t.row} done by #${t.taskId}`)].join("\n") : "Nothing to tick.",
      )
      return 0
    }
    default:
      throw new UsageError("Use fc checklist import <file> --channel <c> or fc checklist sync <file> --channel <c>")
  }
}
