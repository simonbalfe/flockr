import { databaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { resetBoard, seedBoard } from "../src/seed/seed"

const connection = connect(databaseUrl, 1)
if (process.argv.includes("--reset")) {
  await resetBoard(connection.db)
  console.log("board wiped")
}
const seeded = await seedBoard(connection.db)
console.log(seeded ? "seeded the example board" : "board already has data; nothing to do (use --reset to wipe and seed again)")
await connection.close()
