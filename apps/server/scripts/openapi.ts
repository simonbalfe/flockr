import path from "node:path"
import { createApp } from "../src/app"
import { databaseUrl } from "../src/config"
import { connect } from "../src/db/client"

const connection = connect(databaseUrl, 1)
const target = path.resolve(import.meta.dirname, "../../../packages/client/openapi.json")
await Bun.write(target, `${JSON.stringify(createApp(connection.db).document(), null, 2)}\n`)
await connection.close()
console.log(`wrote ${path.relative(process.cwd(), target)}`)
