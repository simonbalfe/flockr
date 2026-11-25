import { bunBinary, childEnv, inheritedPath, noRunner, runnerEntry, shimDir, webDir } from "./config"
import { harnesses } from "./harness/registry"

const prefix = "runner │ "
const say = (line: string) => console.log(`${prefix}${line}`)

const web = Bun.spawn({ cmd: [bunBinary, "run", "dev"], cwd: webDir, stdio: ["inherit", "inherit", "inherit"] })

const path = `${shimDir}:${inheritedPath}`
const usable = harnesses.filter((h) => h.probe({ PATH: path }).kind === "available")
const skipped = noRunner ? "FLOCKR_NO_RUNNER=1 is set" : usable.length ? null : "no harness is installed on this machine"

async function pipeLines(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      say(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
    }
  }
  if (buffer) say(buffer)
}

let stopping = false

function startRunner() {
  if (skipped) {
    say(`not started: ${skipped}. Start it alone with bun run runner`)
    return null
  }
  try {
    const runner = Bun.spawn({ cmd: [bunBinary, runnerEntry], env: childEnv({ FLOCKR_RUNNER_QUIET: "1" }), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    void Promise.all([pipeLines(runner.stdout), pipeLines(runner.stderr)]).catch(() => undefined)
    void runner.exited.then((code) => {
      if (!stopping && code !== 0) say(`exited with code ${code}; the board keeps running. Start it alone with bun run runner`)
    })
    return runner
  } catch (error) {
    say(`could not start: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const runner = startRunner()

const stop = (signal: NodeJS.Signals) => {
  stopping = true
  runner?.kill(signal)
  web.kill(signal)
}
process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))

const code = await web.exited
stopping = true
if (runner && runner.exitCode === null) {
  runner.kill("SIGTERM")
  await runner.exited
}
process.exit(code)
