import { latestBackup, readBackup, restoreDatabase } from "../src/backup/backup"
import { databaseUrl } from "../src/config"
import { connect } from "../src/db/client"
import { runMigrations } from "../src/db/migrate"
import { s3SettingsFrom, s3Store } from "../src/storage/s3"

const settings = s3SettingsFrom(process.env)
if (!settings) {
  console.error("No bucket: set FLOCKR_S3_ENDPOINT, FLOCKR_S3_BUCKET, FLOCKR_S3_ACCESS_KEY_ID and FLOCKR_S3_SECRET_ACCESS_KEY")
  process.exit(1)
}
const store = s3Store(settings)
const key = process.argv[2] ?? (await latestBackup(store))
if (!key) {
  console.error("The bucket has no backups yet")
  process.exit(1)
}
const connection = connect(databaseUrl, 1)
try {
  await runMigrations(connection.db)
  const result = await restoreDatabase(connection.sql, await readBackup(store, key))
  console.log(`restored ${key}: ${result.rows} rows in ${result.tables} tables`)
} finally {
  await connection.close()
}
