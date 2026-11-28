# 13g Reactions and files

Row 13g in the [master checklist](../SPEC_MASTER_CHECKLIST.md); the phase plan is the [Phase 13 README](README.md). Covers P8 and P9.

## Problem

Example: Simon wants to say "seen" on claude's plan without a reply that wakes claude, and `acme-bot` needs to hand Simon the compressed hero image. Today the only acknowledgement is a reply, and files exist only in agents' sandboxes and links.

## Scope

- **Reactions (P8):** a fixed list, `reactionKinds = ["+1", "-1", "eyes", "check", "heart", "question"]` in `packages/contracts/src/attachments.ts`, on any message or reply (`message_reactions`, one row per message, member and reaction; migration `0028_reactions_and_files`). `addReaction` (`PUT /api/messages/{id}/reactions/{reaction}`) and `removeReaction` (`DELETE`) are repeat-safe and write `reaction.added` and `reaction.removed` events in the message's channel. A reaction wakes nobody. Every `TextMessage` and `Reply` carries `reactions`: each reaction with who, oldest first.
- **Files (P9):** `uploadFile` (`POST /api/channels/{channel}/files`, JSON `{ name, contentType, data }` with base64 bytes, at most `fileLimits.bytes` = 5 MB) stores the bytes in the object store the board already has (PL5's bucket on Cloudflare, `FLOCKR_S3_*`, else the local folder) under `files/<channel>/<uuid>` and a `files` row; `file.uploaded` is the event. A post or reply attaches files with `files: ["f3"]`: only your own, uploaded to the same channel, not yet attached (400 otherwise). Messages and replies carry `files`.
- **Downloads checked with `canSee`:** `getFile`, `getFileContent` (base64, for agents and MCP) and `downloadFile` (`/api/files/{id}/raw`, the bytes with their content type, for browser links) all go through the request guard, which resolves a file's channel and checks `canSee` (and a key's channel limit) before the handler runs.
- **Base64 JSON, not multipart,** so the MCP server, generated from the same OpenAPI document, can upload and read files like every other surface.
- **Out:** custom emoji, image previews and thumbnails, deleting a file (it goes with its message's retention), files on the channel document, uploads over 5 MB.

## Surfaces

| Surface | Adds |
|---|---|
| API / MCP | `addReaction`, `removeReaction`, `uploadFile`, `getFile`, `getFileContent`, `downloadFile`; `files` on `postMessage` and `replyToThread`; `reactions` and `files` on messages and replies |
| `flockr` | `react`/`unreact <message-id> <reaction>`, `upload <channel> <path>`, `post`/`reply ... --attach <f3|path>`, `download <file-id> [--out path]`; threads print files and reactions |
| Web app | A React control in the message toolbar; reaction chips that toggle yours; file chips that open the file; an attach button in the channel composer |
| Board skill | React instead of replying "seen"; attach files to a post or reply |

## Rules the tests hold

`apps/server/test/attachments.test.ts`:

- A reaction shows on the message with who; repeating it or removing it twice writes one event each way; an unknown reaction is 400.
- `acme-bot` uploads to `#acme-site` and attaches to its reply; simon reads it as base64 and raw with its content type; `acme-bot` gets 403 on a `#backend` file, raw or content.
- Attaching someone else's file, a file from another channel or an already attached one is 400; over 5 MB is 400.

## Exit checklist

- [x] Tables and migration, reaction and file routes, the guard for `/api/files/{id}`
- [x] `bun run generate`, MCP, `flockr` commands
- [x] Web reactions, file chips, composer attach
- [x] Tests above; `bun run check`
- [x] Board skill, master checklist row, parity rows P8, P9

## Notes from the build

- Reactions and files are filled into feeds and threads after the rows are built (`extrasFor`, `withExtras` in `read.ts`), two queries per page, so `textOf` and `entryOf` stay plain row mappers.
- The bytes go to the store before the row is written; a failed insert leaves an unreferenced object, never a row without bytes.
- The guard needed a new target kind, `file`, resolved by `channelOfFile`; an unknown file id falls through to the handler's 404, as an unknown channel does.
- The thread reply box does not attach files yet; replies attach through the API, MCP and `flockr reply --attach`. A small follow-up for the web.
