import { dockerSandbox } from "./docker"
import type { SandboxProvider } from "./sandbox"

export * from "./sandbox"

// The provider list: adding one is an adapter plus one entry here. Cloud adapters that need a
// platform binding (Cloudflare Containers) register from that platform's folder instead.
export const providers: Record<string, () => SandboxProvider> = {
  docker: dockerSandbox,
}

export function sandboxFor(name: string): SandboxProvider {
  const make = providers[name]
  if (!make) throw new Error(`No sandbox provider ${name}; known: ${Object.keys(providers).join(", ")}`)
  return make()
}
