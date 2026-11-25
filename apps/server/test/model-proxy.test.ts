import { describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { issueBoxToken, modelProxySettingsFrom, verifyBoxToken, type ModelProxySettings } from "../src/model-proxy/proxy"
import { testConnection } from "./harness"

const secret = "a-test-secret-that-is-long-enough-123"
const realKey = "model-key-never-in-a-box"

interface Seen {
  url: string
  method: string
  headers: Headers
  body: string
}

async function proxyApp() {
  const seen: Seen[] = []
  const settings: ModelProxySettings = {
    baseUrl: "https://models.example.test/api/v1",
    key: realKey,
    keyHeader: "authorization",
    secret,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : "" })
      return new Response("data: {\"ok\":true}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as typeof fetch,
  }
  const app = createApp((await testConnection()).db, { modelProxy: settings })
  return { app, seen }
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000)

describe("model key proxy (PL8)", () => {
  test("a live box token reaches the model with the real key, which the box never sees", async () => {
    const { app, seen } = await proxyApp()
    const token = await issueBoxToken(secret, { box: "box-806", expiresAt: inAnHour() })
    const response = await app.request("/api/model/chat/completions?stream=true", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", cookie: "session=x", "x-flockr-member": "simon" },
      body: JSON.stringify({ model: "some-model", messages: [{ role: "user", content: "Design the users table" }] }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"ok":true')
    expect(seen).toHaveLength(1)
    const call = seen[0]!
    expect(call.url).toBe("https://models.example.test/api/v1/chat/completions?stream=true")
    expect(call.method).toBe("POST")
    expect(call.headers.get("authorization")).toBe(`Bearer ${realKey}`)
    expect(call.headers.get("cookie")).toBeNull()
    expect(call.headers.get("x-flockr-member")).toBeNull()
    expect(call.body).toContain("Design the users table")
  })

  test("a token in x-api-key works too, for harnesses that send it there", async () => {
    const { app, seen } = await proxyApp()
    const token = await issueBoxToken(secret, { box: "box-808", expiresAt: inAnHour() })
    const response = await app.request("/api/model/messages", { method: "POST", headers: { "x-api-key": token }, body: "{}" })
    expect(response.status).toBe(200)
    expect(seen[0]?.headers.get("x-api-key")).toBeNull()
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${realKey}`)
  })

  test("no token, an expired one, a forged one or the real key itself is refused without calling the model", async () => {
    const { app, seen } = await proxyApp()
    const expired = await issueBoxToken(secret, { box: "box-806", expiresAt: new Date(Date.now() - 1000) })
    const forged = await issueBoxToken("another-secret-that-is-long-enough-456", { box: "box-806", expiresAt: inAnHour() })
    const good = await issueBoxToken(secret, { box: "box-806", expiresAt: inAnHour() })
    const tampered = `${good.slice(0, 10)}x${good.slice(11)}`
    const cases: Record<string, string>[] = [{}, { authorization: `Bearer ${expired}` }, { authorization: `Bearer ${forged}` }, { authorization: `Bearer ${tampered}` }, { authorization: `Bearer ${realKey}` }]
    for (const headers of cases) {
      const response = await app.request("/api/model/chat/completions", { method: "POST", headers, body: "{}" })
      expect(response.status).toBe(401)
    }
    expect(seen).toHaveLength(0)
  })

  test("with no model set up the proxy answers 404, and settings come from the environment", async () => {
    const app = createApp((await testConnection()).db)
    const token = await issueBoxToken(secret, { box: "b", expiresAt: inAnHour() })
    expect((await app.request("/api/model/x", { headers: { authorization: `Bearer ${token}` } })).status).toBe(404)
    expect(modelProxySettingsFrom({}, secret)).toBeNull()
    const settings = modelProxySettingsFrom({ FLOCKR_MODEL_BASE_URL: "https://models.example.test/v1", FLOCKR_MODEL_KEY: "k", FLOCKR_MODEL_KEY_HEADER: "X-Api-Key" }, secret)
    expect(settings).toMatchObject({ keyHeader: "x-api-key", key: "k" })
    expect((await verifyBoxToken(secret, token, new Date()))?.box).toBe("b")
  })
})
