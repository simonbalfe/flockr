import { dockerSandbox } from "./docker"
import type { SandboxProvider } from "./sandbox"

export * from "./sandbox"

export const providers: Record<string, () => SandboxProvider> = {
  docker: dockerSandbox,
}

export function sandboxFor(name: string): SandboxProvider {
  const make = providers[name]
  if (!make) throw new Error(`No sandbox provider ${name}; known: ${Object.keys(providers).join(", ")}`)
  return make()
}
