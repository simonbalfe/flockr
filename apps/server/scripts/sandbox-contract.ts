import { spawn } from "node:child_process"
import path from "node:path"

const port = 8798
const url = `http://127.0.0.1:${port}`
const config = path.join(import.meta.dir, "sandbox-worker", "wrangler.jsonc")

console.log(`sandbox contract: starting wrangler dev with local containers (${config}); the first run builds the box image`)
const dev = spawn("bunx", ["wrangler", "dev", "--config", config, "--port", String(port), "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] })
const ready = new Promise<void>((resolve, reject) => {
  const scan = (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    process.stdout.write(text.replace(/^/gm, "wrangler │ "))
    if (text.includes("Ready on")) resolve()
  }
  dev.stdout.on("data", scan)
  dev.stderr.on("data", scan)
  dev.on("exit", (code) => reject(new Error(`wrangler dev exited with ${code}`)))
})

let code = 1
try {
  await ready
  const test = Bun.spawn(["bun", "test", "--timeout", "180000", "test/sandbox-cloudflare.test.ts"], { cwd: path.join(import.meta.dir, ".."), env: { ...process.env, FLOCKR_SANDBOX_CONTRACT_URL: url }, stdout: "inherit", stderr: "inherit" })
  code = await test.exited
} finally {
  dev.kill("SIGINT")
}
process.exit(code)
