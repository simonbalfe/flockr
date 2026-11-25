import { ChannelParams, ChecklistImport, ImportChecklistBody } from "@flockr/contracts"
import { importChecklist } from "../board/checklist"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["tasks"]

export const checklistRoutes = router().openapi(
  operation({
    method: "post",
    path: "/api/channels/{channel}/checklist",
    operationId: "importChecklist",
    tags,
    summary:
      "Import a SPEC_MASTER_CHECKLIST.md into a channel: each row not Done becomes a task titled `<id> <name>`, labelled checklist and checklist:<id>, needing the row before it in its phase. Rows that already have a task are skipped, so it is safe to repeat.",
    request: { params: ChannelParams, body: jsonBody(ImportChecklistBody) },
    responses: ok(ChecklistImport),
  }),
  async (c) => c.json(await importChecklist(c.var.db, c.var.member, c.req.valid("param").channel, c.req.valid("json").markdown), 200),
)
