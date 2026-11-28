import { authBasePath, hostOrg, signInWording } from "@flockr/contracts"
import { betterAuth } from "better-auth/minimal"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware } from "better-auth/api"
import { magicLink } from "better-auth/plugins/magic-link"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createMember } from "../board/members"
import { findAnyMember } from "../board/read"
import type { Database } from "../db/client"
import { authAccounts, authSessions, authUsers, authVerifications } from "../db/schema"
import type { AuthSettings } from "./settings"

const linkMinutes = 15
const EmailField = z.object({ email: z.string() })

export const memberFor = (settings: AuthSettings, email: string): string | undefined => settings.people.get(email.trim().toLowerCase())

async function ensurePerson(db: Database, name: string): Promise<void> {
  if (await findAnyMember(db, name)) return
  await createMember(db, name, { name, kind: "person", org: hostOrg, owner: null, runsIn: null, source: null })
}

export function createBetterAuth(db: Database, settings: AuthSettings) {
  const allowed = (email: unknown) => {
    const parsed = EmailField.safeParse({ email })
    return parsed.success && memberFor(settings, parsed.data.email) !== undefined
  }
  return betterAuth({
    appName: "Flockr",
    baseURL: settings.baseURL,
    basePath: authBasePath,
    secret: settings.secret,
    trustedOrigins: [new URL(settings.baseURL).origin],
    telemetry: { enabled: false },
    advanced: { cookiePrefix: "flockr" },
    database: drizzleAdapter(db, { provider: "pg", schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications } }),
    plugins: [
      magicLink({
        expiresIn: linkMinutes * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          if (!allowed(email)) return
          await settings.email.send({ to: email, subject: signInWording.subject, text: `Sign in to Flockr with this link. It works once, for ${linkMinutes} minutes.\n\n${url}\n` })
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return
        if (!allowed(EmailField.safeParse(ctx.body).data?.email)) return ctx.json({ status: true })
      }),
    },
    databaseHooks: {
      user: {
        create: { before: async (user) => (allowed(user.email) ? undefined : false) },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, session.userId))
            const member = user ? memberFor(settings, user.email) : undefined
            if (!member) return false
            await ensurePerson(db, member)
            return undefined
          },
        },
      },
    },
  })
}

export type BetterAuth = ReturnType<typeof createBetterAuth>
