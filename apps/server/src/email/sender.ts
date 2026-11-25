export const emailProviders = ["log", "cloudflare"] as const
export type EmailProvider = (typeof emailProviders)[number]

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  send: (message: EmailMessage) => Promise<void>
}

export type EmailSenders = Partial<Record<EmailProvider, () => EmailSender>>

export function pickSender(senders: EmailSenders, provider: EmailProvider): EmailSender {
  const make = senders[provider]
  if (!make) throw new Error(`The ${provider} email sender is not available here; set FLOCKR_EMAIL to one of: ${Object.keys(senders).join(", ")}`)
  return make()
}
