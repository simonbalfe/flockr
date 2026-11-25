import { z } from "@hono/zod-openapi"

export const shortShaLength = 7
export const commitMessageChars = 500

export const Sha = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{7,64}$/, "A commit sha is 7 to 64 hex characters")
  .openapi({ example: "a1b2c3d" })

export const Repo = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[A-Za-z0-9_.-]+)+$/, "A repo is host and path with no https://, such as github.com/simonbalfe/flockr")
  .openapi({ example: "github.com/simonbalfe/flockr", description: "Where the channel's code lives; commits link to https://<repo>/commit/<sha>" })

export const shortSha = (sha: string): string => sha.slice(0, shortShaLength)

export const commitUrl = (repo: string | null, sha: string): string | null => (repo ? `https://${repo}/commit/${sha}` : null)
