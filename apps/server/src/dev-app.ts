import { createApp } from "./app"
import { localAuthSettings } from "./auth/local"
import { devConnection } from "./dev-connection"

export default createApp(devConnection().db, { auth: localAuthSettings() })
