import { authModes, type AuthMode } from "@flockr/contracts"
import { z } from "zod"
import { emailProviders, pickSender, type EmailProvider, type EmailSender, type EmailSenders } from "../email/sender"

export type People = ReadonlyMap<string, string>

const memberName = z.string().regex(/^[a-z][a-z0-9-]*$/)

const Pair = z
  .string()
  .trim()
  .transform((pair) => pair.split("="))
  .pipe(z.tuple([z.email().trim().toLowerCase(), memberName.trim()]))

export const PeopleList = z
  .string()
  .default("")
  .transform((text) => text.split(",").filter((pair) => pair.trim() !== ""))
  .pipe(z.array(Pair))
  .transform((pairs): People => new Map(pairs))

const localSecret = "flockr-local-development-only-not-for-a-deploy"

export const AuthEnv = z
  .object({
    FLOCKR_AUTH: z.enum(authModes).default("off"),
    FLOCKR_PEOPLE: PeopleList,
    FLOCKR_AUTH_SECRET: z.string().min(32).optional(),
    FLOCKR_URL: z.url().optional(),
    FLOCKR_EMAIL: z.enum(emailProviders).default("log"),
    FLOCKR_EMAIL_FROM: z.email().default("flockr@example.com"),
  })
  .refine((env) => env.FLOCKR_AUTH === "off" || env.FLOCKR_AUTH_SECRET !== undefined, { error: "FLOCKR_AUTH=on needs FLOCKR_AUTH_SECRET (32 characters or more)" })

export interface AuthConfig {
  mode: AuthMode
  people: People
  secret: string
  baseURL: string
  emailProvider: EmailProvider
  emailFrom: string
}

export interface AuthSettings {
  mode: AuthMode
  people: People
  secret: string
  baseURL: string
  email: EmailSender
}

export function authConfig(raw: unknown, fallbackURL: string): AuthConfig {
  const parsed = AuthEnv.safeParse(raw)
  if (!parsed.success) throw new Error(`Sign-in settings: ${parsed.error.issues.map((i) => `${i.path.join(".") || "env"} ${i.message}`).join("; ")}`)
  const env = parsed.data
  return {
    mode: env.FLOCKR_AUTH,
    people: env.FLOCKR_PEOPLE,
    secret: env.FLOCKR_AUTH_SECRET ?? localSecret,
    baseURL: env.FLOCKR_URL ?? fallbackURL,
    emailProvider: env.FLOCKR_EMAIL,
    emailFrom: env.FLOCKR_EMAIL_FROM,
  }
}

export function authSettings(config: AuthConfig, senders: EmailSenders): AuthSettings {
  const email = config.mode === "on" ? pickSender(senders, config.emailProvider) : { send: async () => undefined }
  return { mode: config.mode, people: config.people, secret: config.secret, baseURL: config.baseURL, email }
}

export const authOff: AuthSettings = { mode: "off", people: new Map(), secret: localSecret, baseURL: "http://localhost", email: { send: async () => undefined } }
