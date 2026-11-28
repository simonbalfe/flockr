import { AwsClient } from "aws4fetch"
import { z } from "zod"
import type { ObjectStore } from "./store"

export const S3Settings = z.object({
  endpoint: z.url(),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  region: z.string().min(1).default("auto"),
})
export type S3Settings = z.infer<typeof S3Settings>

type Env = Record<string, unknown>

export function s3SettingsFrom(env: Env): S3Settings | null {
  const value = (name: string) => (typeof env[name] === "string" && env[name] !== "" ? env[name] : undefined)
  if (!value("FLOCKR_S3_BUCKET")) return null
  return S3Settings.parse({
    endpoint: value("FLOCKR_S3_ENDPOINT"),
    bucket: value("FLOCKR_S3_BUCKET"),
    accessKeyId: value("FLOCKR_S3_ACCESS_KEY_ID"),
    secretAccessKey: value("FLOCKR_S3_SECRET_ACCESS_KEY"),
    region: value("FLOCKR_S3_REGION"),
  })
}

const preconditionFailed = 412

const ListPage = z.object({ keys: z.array(z.string()), next: z.string().nullable() })

function parseList(xml: string): z.infer<typeof ListPage> {
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => decodeXml(match[1] ?? ""))
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1]
  return ListPage.parse({ keys, next: truncated && token ? decodeXml(token) : null })
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
}

export function s3Store(settings: S3Settings): ObjectStore {
  const client = new AwsClient({ accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, service: "s3", region: settings.region })
  const base = `${settings.endpoint.replace(/\/$/, "")}/${encodeURIComponent(settings.bucket)}`
  const objectUrl = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

  async function send(url: string, init: RequestInit, okStatuses: number[] = []): Promise<Response> {
    const response = await client.fetch(url, init)
    if (!response.ok && !okStatuses.includes(response.status)) {
      throw new Error(`S3 ${init.method ?? "GET"} ${new URL(url).pathname} failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
    }
    return response
  }

  return {
    async put(key, body, contentType) {
      await send(objectUrl(key), { method: "PUT", body: Uint8Array.from(body), headers: { "content-type": contentType } })
    },
    async create(key, body, contentType) {
      const response = await send(objectUrl(key), { method: "PUT", body: Uint8Array.from(body), headers: { "content-type": contentType, "if-none-match": "*" } }, [preconditionFailed])
      return response.status === preconditionFailed ? "exists" : "created"
    },
    async get(key) {
      const response = await send(objectUrl(key), { method: "GET" }, [404])
      if (response.status === 404) return null
      return new Uint8Array(await response.arrayBuffer())
    },
    async list(prefix) {
      const keys: string[] = []
      let token: string | null = null
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix })
        if (token) query.set("continuation-token", token)
        const page = parseList(await (await send(`${base}?${query}`, { method: "GET" })).text())
        keys.push(...page.keys)
        token = page.next
      } while (token)
      return keys.sort()
    },
    async remove(key) {
      await send(objectUrl(key), { method: "DELETE" }, [404])
    },
  }
}
