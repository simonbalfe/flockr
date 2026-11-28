import { z } from "zod"
import { signToken, verifyToken, type Signer } from "./signed"

const signer: Signer = { prefix: "fag_", purpose: "flockr-agent" }

export const agentTokenMinutes = 15

const AgentClaims = z.object({ agent: z.string().min(1), exp: z.number().int() })
export type AgentClaims = z.infer<typeof AgentClaims>

export const isAgentToken = (token: string) => token.startsWith(signer.prefix)

export const issueAgentToken = (secret: string, agent: string, now = new Date()): Promise<string> => signToken(signer, secret, { agent, exp: now.getTime() + agentTokenMinutes * 60_000 })

export const verifyAgentToken = (secret: string, token: string, now: Date): Promise<AgentClaims | null> => verifyToken(signer, AgentClaims, secret, token, now)
