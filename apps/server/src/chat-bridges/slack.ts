import { postSlackMessage, sendSlackResponseUrl } from "@chat-adapter/slack/api"
import { parseSlackWebhookBody, verifySlackSignature } from "@chat-adapter/slack/webhook"
import { bridgeLimits } from "@flockr/contracts"
import { z } from "zod"
import type { BridgeConnection, BridgeInbound, BridgePost, ChatBridge } from "./bridge"

const secretChars = 16

const MessageEvent = z.object({
  type: z.literal("event_callback"),
  event_id: z.string().min(1),
  event: z.object({
    type: z.string(),
    channel: z.string().optional(),
    channel_type: z.string().optional(),
    user: z.string().optional(),
    text: z.string().optional(),
    ts: z.string().optional(),
    thread_ts: z.string().optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
  }),
})

const syncedChannelTypes: ReadonlySet<string> = new Set(["channel", "group"])

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" }

export function slackToMarkdown(text: string): string {
  return text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/&(amp|lt|gt);/g, (found) => entities[found] ?? found)
}

function parseEvent(raw: unknown): BridgeInbound {
  const found = MessageEvent.safeParse(raw)
  if (!found.success) return { kind: "ignored", reason: "Not a message event" }
  const { event_id: key, event } = found.data
  if (event.type !== "message") return { kind: "ignored", reason: `A ${event.type} event` }
  if (event.subtype || event.bot_id) return { kind: "ignored", reason: "An edit, a bot message or another subtype" }
  if (!event.channel_type || !syncedChannelTypes.has(event.channel_type)) return { kind: "ignored", reason: "Not a channel message" }
  if (!event.channel || !event.user || !event.ts || !event.text) return { kind: "ignored", reason: "A message with no channel, user or text" }
  const thread = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null
  return { kind: "message", key, channel: event.channel, ts: event.ts, thread, user: event.user, text: slackToMarkdown(event.text) }
}

function parse(headers: Headers, body: string): BridgeInbound {
  const payload = parseSlackWebhookBody(body, { headers })
  switch (payload.kind) {
    case "url_verification":
      return { kind: "challenge", challenge: payload.challenge }
    case "block_actions": {
      const [action] = payload.actions
      const key = payload.triggerId ?? (typeof action?.raw.action_ts === "string" ? `${payload.userId}:${action.raw.action_ts}` : null)
      if (!action?.value || !payload.channelId || !key) return { kind: "ignored", reason: "A button press with no value, channel or id" }
      return { kind: "action", key, channel: payload.channelId, user: payload.userId, value: action.value, respondTo: payload.responseUrl ?? null }
    }
    case "unsupported":
      return parseEvent(payload.raw)
    case "app_mention":
    case "direct_message":
    case "slash_command":
    case "block_suggestion":
    case "view_submission":
    case "view_closed":
      return { kind: "ignored", reason: `Slack ${payload.kind} is not synced` }
    default: {
      const unhandled: never = payload
      return unhandled
    }
  }
}

const plain = (text: string) => text.slice(0, bridgeLimits.textChars)

function blocksOf(post: BridgePost): unknown[] {
  return [
    { type: "markdown", text: plain(post.text) },
    {
      type: "actions",
      elements: post.buttons.slice(0, bridgeLimits.buttons).map((button, i) => ({
        type: "button",
        action_id: `flockr_${i}`,
        text: { type: "plain_text", text: button.label.slice(0, 75) },
        value: button.value,
      })),
    },
  ]
}

async function post(connection: BridgeConnection, message: BridgePost): Promise<{ ts: string }> {
  const base = { token: connection.token, fetch: connection.fetch, channel: message.channel, ...(message.thread ? { threadTs: message.thread } : {}), unfurlLinks: false }
  const sent = message.buttons.length
    ? await postSlackMessage({ ...base, text: plain(message.text), blocks: blocksOf(message) })
    : await postSlackMessage({ ...base, markdownText: plain(message.text) })
  return { ts: sent.id }
}

export const slack: ChatBridge = {
  name: "slack",
  label: "Slack",
  memberName: "slack",
  channelId: /^[CG][A-Z0-9]{2,20}$/,
  userId: /^[UW][A-Z0-9]{2,20}$/,
  connectionFrom(env) {
    const secret = env.FLOCKR_SLACK_SIGNING_SECRET
    const token = env.FLOCKR_SLACK_BOT_TOKEN
    if (typeof secret !== "string" || secret.length < secretChars || typeof token !== "string" || !token) return null
    return { secret, token, fetch }
  },
  async verify(headers, body, connection) {
    try {
      await verifySlackSignature(body, headers, { signingSecret: connection.secret })
      return true
    } catch {
      return false
    }
  },
  parse,
  post,
  async tell(connection, respondTo, text) {
    await sendSlackResponseUrl(respondTo, { text, responseType: "ephemeral", replaceOriginal: false }, { fetch: connection.fetch })
  },
  unlinkedAuthor: (user) => `Slack user ${user}`,
}
