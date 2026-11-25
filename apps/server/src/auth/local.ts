import { readAuthConfig } from "../config"
import { logEmail } from "../email/log"
import { authSettings, type AuthSettings } from "./settings"

export const localAuthSettings = (): AuthSettings => authSettings(readAuthConfig(), { log: () => logEmail() })
