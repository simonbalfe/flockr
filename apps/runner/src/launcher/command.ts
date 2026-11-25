import type { RunCommand } from "./types"

export const runCommand: RunCommand = async (argv) => {
  try {
    const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, stdout, stderr }
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
  }
}
