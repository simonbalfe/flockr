import { z } from "zod"
import type { CommandResult, Launcher, PaneOptions, PaneResult, Panes, PaneSpec } from "./types"

const terminalCli = "hc"
const appCli = "herdr-app"
const nameMax = 32

const terminalStates = ["live", "finished"] as const
const Terminal = z.object({ address: z.string().min(1), state: z.enum(terminalStates).catch("finished") })
const Layout = z.object({ spaces: z.array(z.object({ id: z.string().min(1), name: z.string() })).catch([]) })

function decode<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const said = (result: CommandResult) => (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`).replace(/\s+/g, " ").slice(0, 200)

export const paneName = (key: string) =>
  `flockr-${key}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, nameMax)

function herdrPanes(options: PaneOptions): Panes {
  const { run, space } = options
  let chain: Promise<unknown> = Promise.resolve()

  async function findSpace(): Promise<string | null> {
    const listed = await run([appCli, "ls"])
    if (listed.code !== 0) return null
    return decode(Layout, listed.stdout)?.spaces.find((s) => s.name === space)?.id ?? null
  }

  async function ensureSpace(folder: string): Promise<{ id: string } | { reason: string }> {
    const found = await findSpace()
    if (found) return { id: found }
    const made = await run([appCli, "do", "space.new", "--name", space, "--folder", folder, "--focus", "false"])
    if (made.code !== 0) return { reason: `could not open the ${space} space: ${said(made)}` }
    const created = await findSpace()
    if (!created) return { reason: `the ${space} space did not appear after creating it` }
    return { id: created }
  }

  async function live(name: string): Promise<{ kind: "live"; id: string } | { kind: "finished" } | { kind: "none" }> {
    const got = await run([terminalCli, "get", name, "--json"])
    if (got.code !== 0) return { kind: "none" }
    const terminal = decode(Terminal, got.stdout)
    if (!terminal) return { kind: "none" }
    return terminal.state === "live" ? { kind: "live", id: terminal.address } : { kind: "finished" }
  }

  async function show(spec: PaneSpec): Promise<PaneResult> {
    const name = paneName(spec.key)
    const current = await live(name)
    if (current.kind === "live") return { kind: "reused", id: current.id }
    if (current.kind === "finished") await run([terminalCli, "rm", name, "--json"])
    const target = await ensureSpace(spec.folder)
    if ("reason" in target) return { kind: "failed", reason: target.reason }
    const opened = await run([
      terminalCli,
      "run",
      "--bg",
      "--json",
      "--name",
      name,
      "--no-parent",
      "--no-notify",
      "--cwd",
      spec.folder,
      "--label",
      `herdr.space=${target.id}`,
      "--label",
      `flockr.pane=${spec.key}`,
      "--",
      ...spec.argv,
    ])
    if (opened.code !== 0) return { kind: "failed", reason: `could not open pane ${name}: ${said(opened)}` }
    return { kind: "opened", id: decode(Terminal, opened.stdout)?.address ?? name }
  }

  return {
    show(spec) {
      const next = chain.then(() => show(spec))
      chain = next.catch(() => undefined)
      return next
    },
  }
}

export const herdr: Launcher = {
  name: "herdr",
  label: "Herdr",
  probe(env) {
    const missing = [terminalCli, appCli].filter((binary) => !Bun.which(binary, { PATH: env.PATH }))
    return missing.length ? { kind: "missing", reason: `${missing.join(" and ")} not on the PATH` } : { kind: "available" }
  },
  panes: herdrPanes,
}
