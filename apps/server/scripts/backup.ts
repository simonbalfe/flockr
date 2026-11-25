import { backUp } from "../src/backup/backup"
import { databaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { s3SettingsFrom, s3Store } from "../src/storage/s3"

const settings = s3SettingsFrom(process.env)
if (!settings) {
  console.error("No bucket: set FLOCKR_S3_ENDPOINT, FLOCKR_S3_BUCKET, FLOCKR_S3_ACCESS_KEY_ID and FLOCKR_S3_SECRET_ACCESS_KEY")
  process.exit(1)
}
const connection = connect(databaseUrl, 1)
try {
  const result = await backUp(connection.sql, s3Store(settings), new Date())
  console.log(`backup: ${result.key}, ${result.rows} rows, ${result.bytes} bytes${result.removed.length ? `, removed ${result.removed.length} old` : ""}`)
} finally {
  await connection.close()
}
