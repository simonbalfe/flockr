import { ClaimResult, EventPage, LiveFrame, memberHeader } from "@flockr/contracts"
import { testDatabaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { resetBoard, seedBoard } from "../src/seed/seed"

const base = process.env.WORKER_URL ?? "http://127.0.0.1:8787"

async function call(member: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { [memberHeader]: member, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json: unknown = await response.json()
  return { status: response.status, json }
}

function check(name: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`)
  return ok
}

const connection = connect(testDatabaseUrl)
await resetBoard(connection.db)
await seedBoard(connection.db)
await connection.close()

const results: boolean[] = []
const openapi = await fetch(`${base}/api/openapi.json`)
results.push(check("OpenAPI document", openapi.status === 200, `status ${openapi.status}`))

const before = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1")).json).head
const writes = Array.from({ length: 25 }, (_, i) => call(i % 2 ? "claude" : "codex", "POST", "/api/channels/backend/messages", { text: `worker note ${i}` }))
const claims = [call("claude", "POST", "/api/tasks/claim", {}), call("codex", "POST", "/api/tasks/claim", {})]
const all = await Promise.all([...writes, ...claims])
results.push(check("27 concurrent writes succeed", all.every((r) => r.status === 200), all.filter((r) => r.status !== 200).map((r) => r.status).join(", ")))

const page = EventPage.parse((await call("simon", "GET", `/api/events?since=${before}&limit=1000`)).json)
const seqs = page.events.map((e) => e.seq)
const gapless = seqs.every((seq, i) => seq === before + i + 1) && seqs.length === page.head - before
results.push(check("sequence numbers are gapless", gapless, `${before + 1}..${page.head}, ${seqs.length} events`))

const claimed = (await Promise.all(claims)).map((r) => ClaimResult.parse(r.json).task?.id).filter((id) => id !== undefined)
results.push(check("two claims never take the same task", new Set(claimed).size === claimed.length, `tasks ${claimed.map((id) => `#${id}`).join(", ") || "none ready"}`))


async function liveFrames(since: number, count: number, during: () => Promise<unknown>): Promise<LiveFrame[]> {
  const frames: LiveFrame[] = []
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws?since=${since}`)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve())
    socket.addEventListener("error", () => reject(new Error("socket failed to open")))
  })
  socket.addEventListener("message", (message) => frames.push(LiveFrame.parse(JSON.parse(String(message.data)))))
  await during()
  const deadline = Date.now() + 5000
  while (frames.filter((f) => f.kind === "event").length < count && Date.now() < deadline) await Bun.sleep(25)
  socket.close()
  return frames
}

const head = EventPage.parse((await call("simon", "GET", "/api/events?since=0&limit=1")).json).head
const streamed = await liveFrames(head, 1, () => call("claude", "POST", "/api/channels/backend/messages", { text: "live over the board room" }))
const live = streamed.flatMap((f) => (f.kind === "event" ? [f.event] : []))
results.push(check("a new message streams over /ws", live.some((e) => e.type === "message.posted" && e.seq === head + 1), live.map((e) => `${e.seq} ${e.type}`).join(", ")))

const replayed = await liveFrames(head - 2, 3, async () => undefined)
const replaySeqs = replayed.flatMap((f) => (f.kind === "event" ? [f.event.seq] : []))
results.push(check("a socket opened at an older sequence catches up", replaySeqs.join(",") === [head - 1, head, head + 1].join(","), replaySeqs.join(", ")))

process.exit(results.every(Boolean) ? 0 : 1)
