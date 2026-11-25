import { testConnection } from "./harness"

// Create and migrate the test database once, before any test starts, so a new migration's
// first run never counts against one test's timeout.
await testConnection()
