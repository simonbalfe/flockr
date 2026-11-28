import { spawnSync } from "node:child_process"
import { describe } from "bun:test"
import { sandboxFor } from "../src"
import { sandboxContract } from "./contract"

const dockerUp = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0

if (dockerUp) sandboxContract("docker sandbox (PL6)", () => sandboxFor("docker"), { image: "alpine:3.20", diskMb: 8, diskCap: { diskMb: 8, writeMb: 20 }, settleMs: 2500 })
else describe.skip("docker sandbox (PL6): Docker is not running", () => undefined)
