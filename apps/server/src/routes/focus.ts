import { Focus } from "@flockr/contracts"
import { getFocus } from "../board/focus"
import { ok, operation, router } from "./shared"

export const focusRoutes = router().openapi(
  operation({
    method: "get",
    path: "/api/focus",
    operationId: "getFocus",
    tags: ["focus"],
    summary:
      "Everything a person should look at now, on one page: questions, thread questions, reviews and blocked tasks waiting on a person (oldest first), open plans with their progress, agent runs in progress with their last steps, and tasks done since 00:00 UTC",
    responses: ok(Focus),
  }),
  async (c) => c.json(await getFocus(c.var.db, c.var.member), 200),
)
