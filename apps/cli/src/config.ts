import { defaultMember } from "@flockr/client"
import { defaultClaimsFile } from "./epochs"

export const envUrl = process.env.FC_URL ?? "http://localhost:5173"
export const envMember = process.env.FC_AS ?? defaultMember
export const envKey = process.env.FLOCKR_KEY || process.env.FC_KEY || null
export const stateFile = process.env.FC_STATE ?? defaultClaimsFile
