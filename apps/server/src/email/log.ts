import type { EmailSender } from "./sender"

export function logEmail(print: (line: string) => void = console.log): EmailSender {
  return {
    send: async (message) => {
      print(`email to ${message.to}: ${message.subject}\n${message.text}`)
    },
  }
}
