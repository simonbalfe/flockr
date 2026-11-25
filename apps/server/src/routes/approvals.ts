import { ApprovalCheck, ApprovalRule, ApprovalRules, ApprovalScopeQuery, ClearedApprovalRule, SetApprovalRuleBody } from "@flockr/contracts"
import { checkApproval, clearApprovalRule, listApprovalRules, setApprovalRule } from "../board/approvals"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["approvals"]

export const approvalRoutes = router()
  .openapi(
    operation({
      method: "get",
      path: "/api/approval-rules",
      operationId: "listApprovalRules",
      tags,
      summary: "Every action kind with its floor (the loosest verdict any rule may set) and default, and the allow, ask or block rules people have set, board-wide or per channel",
      responses: ok(ApprovalRules),
    }),
    async (c) => c.json(await listApprovalRules(c.var.db), 200),
  )
  .openapi(
    operation({
      method: "put",
      path: "/api/approval-rules",
      operationId: "setApprovalRule",
      tags,
      summary:
        "Set an action kind to allow, ask or block, for one channel or (channel null) the whole board. A verdict looser than the kind's floor is refused: spending money and changing prod always ask at least. Only a person can set a rule; setting the same verdict again changes nothing",
      request: { body: jsonBody(SetApprovalRuleBody) },
      responses: ok(ApprovalRule),
    }),
    async (c) => c.json(await setApprovalRule(c.var.db, c.var.member, c.req.valid("json")), 200),
  )
  .openapi(
    operation({
      method: "delete",
      path: "/api/approval-rules",
      operationId: "clearApprovalRule",
      tags,
      summary: "Clear the rule for an action kind in one channel, or board-wide with no channel, so the board rule or the default applies again. Only a person can clear a rule",
      request: { query: ApprovalScopeQuery },
      responses: ok(ClearedApprovalRule),
    }),
    async (c) => c.json(await clearApprovalRule(c.var.db, c.var.member, c.req.valid("query")), 200),
  )
  .openapi(
    operation({
      method: "get",
      path: "/api/approval-rules/check",
      operationId: "checkApproval",
      tags,
      summary:
        "What happens when an agent or a routine does this kind of action in this channel: allow (go ahead), ask (ask a person in the thread first and wait for Allow once) or block (do not do it). The stricter of the rule and the floor",
      request: { query: ApprovalScopeQuery },
      responses: ok(ApprovalCheck),
    }),
    async (c) => {
      const query = c.req.valid("query")
      return c.json(await checkApproval(c.var.db, query.kind, query.channel ?? null), 200)
    },
  )
