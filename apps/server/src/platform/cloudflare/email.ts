import { EmailMessage } from "cloudflare:email"
import type { EmailMessage as Message, EmailSender } from "../../email/sender"

const ascii = /^[\x20-\x7e]*$/

const encodedWord = (text: string) => (ascii.test(text) ? text : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}?=`)

export function mimeMessage(from: string, message: Message, now = new Date()): string {
  const domain = from.split("@")[1] ?? "flockr.invalid"
  const headers = [
    `From: Flockr <${from}>`,
    `To: <${message.to}>`,
    `Subject: ${encodedWord(message.subject)}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ]
  const body = message.text.replace(/\r?\n/g, "\r\n")
  return `${headers.join("\r\n")}\r\n\r\n${body}`
}

export function cloudflareEmail(binding: SendEmail, from: string): EmailSender {
  return {
    send: async (message) => {
      await binding.send(new EmailMessage(from, message.to, mimeMessage(from, message)))
    },
  }
}
