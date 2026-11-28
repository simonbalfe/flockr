import { createApp } from "./app"
import { localAuthSettings } from "./auth/local"
import { devConnection } from "./dev-connection"
import { hookSettingsFrom } from "./board/hook-route"
import { bridgeSettingsFrom } from "./chat-bridges"
import { modelProxySettingsFrom } from "./model-proxy/proxy"
import { objectsDir } from "./config"
import { localObjectStore } from "./storage/local"

const auth = localAuthSettings()

export default createApp(devConnection().db, { auth, modelProxy: modelProxySettingsFrom(process.env, auth.secret), hooks: hookSettingsFrom(process.env), bridges: bridgeSettingsFrom(process.env), objects: localObjectStore(process.env, objectsDir()) })
