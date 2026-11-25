import { databaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"

const connection = connect(databaseUrl, 1)
await runMigrations(connection.db)
await connection.close()
console.log("migrations applied")
