import { describe, expect, test } from "bun:test"
import { parseConfig } from "../src/config"
import { herdr, paneName } from "../src/launcher/herdr"
import type { CommandResult, RunCommand } from "../src/launcher/types"
import { createRunPanes } from "../src/panes"

const ok = (value: unknown): CommandResult => ({ code: 0, stdout: JSON.stringify(value), stderr: "" })
const missing: CommandResult = { code: 3, stdout: '{"error":{"kind":"not_found"}}', stderr: "" }

function fakeCli(options: { spaces?: { id: string; name: string }[]; terminals?: Record<string, "live" | "finished"> } = {}) {
  const calls: string[] = []
  let spaces = options.spaces ?? [{ id: "spc1", name: "flockr" }]
  const terminals = new Map(Object.entries(options.terminals ?? {}))
  let next = 7
  const run: RunCommand = async (argv) => {
    calls.push(argv.join(" "))
    const [cli, command, ...rest] = argv
    if (cli === "herdr-app" && command === "ls") return ok({ spaces: spaces.map((s) => ({ ...s, tabs: [] })), recent: [] })
    if (cli === "herdr-app" && command === "do") {
      spaces = [...spaces, { id: "spc-new", name: rest[rest.indexOf("--name") + 1] ?? "" }]
      return ok({ terminal: "t1" })
    }
    const name = rest[0] ?? ""
    if (command === "get") {
      const state = terminals.get(name)
      return state ? ok({ address: `t${name.length}`, state, labels: {} }) : missing
    }
    if (command === "rm") {
      terminals.delete(name)
      return ok({ address: "t0", state: "finished" })
    }
    if (command === "run") {
      const named = rest[rest.indexOf("--name") + 1] ?? ""
      terminals.set(named, "live")
      next += 1
      return ok({ address: `t${next}`, state: "live", labels: {} })
    }
    return { code: 2, stdout: "", stderr: `unexpected ${argv.join(" ")}` }
  }
  return { run, calls }
}

const watch = ["/bin/bun", "/repo/apps/cli/src/main.ts", "--url", "http://localhost:5173", "agents", "watch", "scout"]
const spec = { key: "scout", folder: "/work/shop", argv: watch }

describe("the herdr launcher", () => {
  test("opens a named, labelled pane in the configured space that runs the given command, outside any parent", async () => {
    const cli = fakeCli()
    const panes = herdr.panes({ space: "flockr", run: cli.run })
    expect(await panes.show(spec)).toEqual({ kind: "opened", id: "t8" })
    expect(cli.calls).toEqual([
      "hc get flockr-scout --json",
      "herdr-app ls",
      `hc run --bg --json --name flockr-scout --no-parent --no-notify --cwd /work/shop --label herdr.space=spc1 --label flockr.pane=scout -- ${watch.join(" ")}`,
    ])
  })

  test("reuses a live pane by name and opens nothing", async () => {
    const cli = fakeCli()
    const panes = herdr.panes({ space: "flockr", run: cli.run })
    await panes.show(spec)
    const before = cli.calls.length
    expect(await panes.show(spec)).toEqual({ kind: "reused", id: "t12" })
    expect(cli.calls.slice(before)).toEqual(["hc get flockr-scout --json"])
  })

  test("two runs starting at once open one pane", async () => {
    const cli = fakeCli()
    const panes = herdr.panes({ space: "flockr", run: cli.run })
    const results = await Promise.all([panes.show(spec), panes.show({ ...spec, folder: "/work/other" })])
    expect(results.map((r) => r.kind)).toEqual(["opened", "reused"])
    expect(cli.calls.filter((c) => c.startsWith("hc run"))).toHaveLength(1)
  })

  test("a finished pane with that name is removed and opened again", async () => {
    const cli = fakeCli({ terminals: { "flockr-scout": "finished" } })
    const panes = herdr.panes({ space: "flockr", run: cli.run })
    expect((await panes.show(spec)).kind).toBe("opened")
    expect(cli.calls.slice(0, 2)).toEqual(["hc get flockr-scout --json", "hc rm flockr-scout --json"])
  })

  test("a missing space is created once without taking focus", async () => {
    const cli = fakeCli({ spaces: [] })
    const panes = herdr.panes({ space: "flockr", run: cli.run })
    expect((await panes.show(spec)).kind).toBe("opened")
    expect(cli.calls).toContain("herdr-app do space.new --name flockr --folder /work/shop --focus false")
    expect(cli.calls.at(-1)).toContain("--label herdr.space=spc-new")
  })

  test("pane names fit the 32 characters a terminal name allows", () => {
    expect(paneName("a-very-long-agent-name-of-thirty-two")).toBe("flockr-a-very-long-agent-name-of")
    expect(paneName("a-very-long-agent-name-of-thirty-two")).toHaveLength(32)
  })
})

describe("run panes in the runner", () => {
  test("are off unless configured, and an unknown launcher is logged, not fatal", () => {
    const logs: string[] = []
    const base = { path: "/bin", run: fakeCli().run, watch: () => watch, log: (line: string) => void logs.push(line) }
    expect(createRunPanes({ ...base, config: undefined })).toBeNull()
    expect(createRunPanes({ ...base, config: { launcher: "nowhere", space: "flockr" } })).toBeNull()
    expect(logs[0]).toContain("no launcher nowhere")
  })

  test("the config takes a launcher and a space, defaulting the space", () => {
    expect(parseConfig({ panes: { launcher: "herdr" } }).panes).toEqual({ launcher: "herdr", space: "flockr" })
    expect(parseConfig({}).panes).toBeUndefined()
  })
})
