import { createApp } from "./app"
import { localAuthSettings } from "./auth/local"
import { devConnection } from "./dev-connection"
import { modelProxySettingsFrom } from "./model-proxy/proxy"

const auth = localAuthSettings()

export default createApp(devConnection().db, { auth, modelProxy: modelProxySettingsFrom(process.env, auth.secret) })
