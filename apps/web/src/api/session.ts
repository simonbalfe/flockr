import { configureClient, defaultMember } from "@flockr/client"

export let currentUser: string = defaultMember
export const lowLeaseMinutes = 3

configureClient({ baseUrl: window.location.origin, member: currentUser })

export function actAs(name: string): void {
  if (name === currentUser) return
  currentUser = name
  configureClient({ baseUrl: window.location.origin, member: name })
}
