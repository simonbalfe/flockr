import { z } from "@hono/zod-openapi"

export const oauthPaths = {
  register: "/api/oauth/register",
  token: "/api/oauth/token",
  device: "/api/oauth/device",
  revoke: "/api/oauth/revoke",
  authorizePage: "/oauth/authorize",
  devicePage: "/oauth/device",
  authorizationServer: "/.well-known/oauth-authorization-server",
  protectedResource: "/.well-known/oauth-protected-resource",
} as const

export const oauthLimits = {
  codeMinutes: 10,
  deviceMinutes: 10,
  pollSeconds: 5,
  clientNameMax: 100,
  redirectUris: 10,
  redirectUriMax: 500,
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",
} as const

export const oauthScope = "board"

export const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

export const oauthActs = ["me", "agent"] as const
export type OAuthAct = (typeof oauthActs)[number]

export const oauthDecisions = ["allow", "deny"] as const
export type OAuthDecision = (typeof oauthDecisions)[number]

export const oauthGrantKinds = ["code", "device"] as const
export type OAuthGrantKind = (typeof oauthGrantKinds)[number]

export const oauthGrantStates = ["pending", "approved", "denied", "used"] as const
export type OAuthGrantState = (typeof oauthGrantStates)[number]

const channelId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)

export const OAuthClient = z
  .object({
    id: z.string().openapi({ example: "oc_5d1e9a" }),
    name: z.string().openapi({ example: "Claude Code" }),
    redirectUris: z.array(z.string()).openapi({ example: ["http://localhost:52811/callback"] }),
  })
  .openapi("OAuthClient")

export const OAuthClientParams = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" }, example: "oc_5d1e9a" }) })

export const OAuthChoice = z.object({
  decision: z.enum(oauthDecisions).openapi({ description: "allow connects the client; deny sends it back with access_denied" }),
  act: z.enum(oauthActs).default("me").openapi({ description: "me: the client posts as you. agent: it posts as an agent you own, named in agent, or a new one named in newAgent" }),
  agent: z.string().optional().openapi({ example: "scout", description: "With act agent: an agent you own" }),
  newAgent: z.string().optional().openapi({ example: "scout", description: "With act agent: make a new agent you own with this name and connect as it" }),
  channels: z.array(channelId).min(1).max(20).nullable().default(null).openapi({ example: ["backend"], description: "Limit the connection to these channels; null for every channel it can see" }),
})

export const AuthorizeBody = OAuthChoice.extend({
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal("S256"),
  state: z.string().max(500).optional(),
}).openapi("AuthorizeBody")

export const AuthorizeResult = z
  .object({ redirect: z.string().openapi({ description: "Where the browser goes next: the client's redirect with a code, or with error=access_denied" }) })
  .openapi("AuthorizeResult")

export const DeviceRequest = z
  .object({
    userCode: z.string().openapi({ example: "BDFG-HJKL" }),
    client: OAuthClient,
    expiresAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("DeviceRequest")

export const DeviceParams = z.object({ code: z.string().openapi({ param: { name: "code", in: "path" }, example: "BDFG-HJKL" }) })

export const DeviceDecisionBody = OAuthChoice.openapi("DeviceDecisionBody")

export const DeviceDecision = z.object({ status: z.enum(["approved", "denied"]), member: z.string().nullable() }).openapi("DeviceDecision")

export type OAuthClient = z.infer<typeof OAuthClient>
export type OAuthChoice = z.infer<typeof OAuthChoice>
export type AuthorizeBody = z.infer<typeof AuthorizeBody>
export type AuthorizeResult = z.infer<typeof AuthorizeResult>
export type DeviceRequest = z.infer<typeof DeviceRequest>
export type DeviceDecisionBody = z.infer<typeof DeviceDecisionBody>
export type DeviceDecision = z.infer<typeof DeviceDecision>
