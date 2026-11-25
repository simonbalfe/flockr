import { connectLive, memberClient } from "@flockr/client"
import { boardClient } from "./board"
import { bridgeEnv } from "./config"
import { permissionGate, type Answer, type AnswerWatch } from "./gate"
import { harnessFor } from "./harness/registry"
import { mcpHandler, serveStdio } from "./mcp"
import { ruleFor } from "./permissions"
import { eventData, eventTypes } from "./routing"

const env = bridgeEnv()

function watchAnswers(): Promise<AnswerWatch> {
  return new Promise((ready) => {
    const waiting = new Map<string, (answer: Answer) => void>()
    const heard = new Map<string, Answer>()
    const connection = connectLive({
      baseUrl: env.url,
      onHello: () => ready(watch),
      onEvent: (event) => {
        if (event.type !== eventTypes.answered || event.messageId === null) return
        const answer = { option: eventData(event).option ?? "", by: event.actor }
        const resolve = waiting.get(event.messageId)
        if (resolve) resolve(answer)
        else heard.set(event.messageId, answer)
      },
    })
    const watch: AnswerWatch = {
      answerTo: (questionId) =>
        new Promise((resolve) => {
          const early = heard.get(questionId)
          if (early) resolve(early)
          else waiting.set(questionId, resolve)
        }),
      close: () => connection.close(),
    }
  })
}

const gate = permissionGate({
  board: boardClient({ member: env.member, client: memberClient({ baseUrl: env.url, member: env.member }) }),
  codec: harnessFor(env.harness).permissions,
  thread: env.thread,
  watch: watchAnswers,
  log: (line) => console.error(line),
  rule: ruleFor(env.permissions),
})

await serveStdio(mcpHandler(gate))
