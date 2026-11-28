import path from "node:path"
import type { Context } from "@earendil-works/chord/context"
import {
  err,
  ExecutionError,
  FileError,
  LineScanner,
  ok,
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  type FileChange,
  type FileErrorCode,
  type FileInfo,
  type FileKind,
  type FileWatcher,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
  type WatchTarget,
} from "@earendil-works/pi-durable/env"
import { sandboxWorkspace, type RunResult, type SandboxProvider } from "@flockr/sandbox/sandbox"

export const boxCommands = { defaultSeconds: 120, maxSeconds: 900, fileSeconds: 60 } as const

export type BoxFiles = Pick<SandboxProvider, "run" | "readFile" | "writeFile">

const posix = path.posix

const fileErrorOf = (stderr: string, file: string): FileError => {
  const code: FileErrorCode = /No such file|not found|cannot stat/i.test(stderr)
    ? "not_found"
    : /Permission denied|Operation not permitted|Read-only/i.test(stderr)
      ? "permission_denied"
      : /Not a directory/i.test(stderr)
        ? "not_directory"
        : /Is a directory/i.test(stderr)
          ? "is_directory"
          : "unknown"
  return new FileError(code, stderr.trim() || `${file}: failed`, file)
}

const kindOf = (described: string): FileKind => (described.startsWith("directory") ? "directory" : described.startsWith("symbolic link") ? "symlink" : "file")

const statFormat = "%F|%s|%Y|%n"

const statLine = (line: string): FileInfo | null => {
  const [described, size, mtime, ...rest] = line.split("|")
  const name = rest.join("|")
  if (described === undefined || size === undefined || mtime === undefined || !name) return null
  return { name: posix.basename(name), path: name, kind: kindOf(described), size: Number(size), mtimeMs: Number(mtime) * 1000 }
}

const abortedFile = (file?: string) => err<never, FileError>(new FileError("aborted", "aborted", file))

const encoder = new TextEncoder()
const decoder = new TextDecoder()


function bytesReader(info: FileInfo, bytes: Uint8Array): BinaryReader {
  return {
    info: async () => ok(info),
    read: async (offset, length) => ok(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length))),
    scanLines: async (options) => {
      const scanner = new LineScanner(options.startLine, options.endLine)
      scanner.push(bytes)
      return ok(scanner.finish())
    },
    close: async () => undefined,
  }
}

function linesReader(lines: string[], endsWithNewline: boolean): TextLineReader {
  let next = 0
  return {
    readLine: async () => {
      const text = lines[next]
      if (text === undefined) return ok(undefined)
      next += 1
      return ok({ text, terminated: next < lines.length || endsWithNewline })
    },
    close: async () => undefined,
  }
}

function pagedReader(entries: FileInfo[]): DirReader {
  let at = 0
  let closed = false
  return {
    next: async (maxEntries) => {
      if (closed) return err(new FileError("invalid", "The directory reader is closed"))
      const page = entries.slice(at, at + maxEntries)
      at += page.length
      return ok({ entries: page, done: at >= entries.length })
    },
    close: async () => void (closed = true),
  }
}

const splitLines = (text: string) => {
  const endsWithNewline = text.endsWith("\n")
  const lines = text.split("\n")
  if (endsWithNewline) lines.pop()
  return { lines: text.length === 0 ? [] : lines, endsWithNewline }
}

export function boxExecutionEnv(options: { box: BoxFiles; id: string; cwd?: string }): ExecutionEnv {
  const { box, id } = options
  const cwd = options.cwd ?? sandboxWorkspace
  const resolve = (file: string) => posix.resolve(cwd, file.replace(/^~(?=\/|$)/, sandboxWorkspace))

  const sh = (script: string, args: string[], context: Context, stdin?: string | Uint8Array): Promise<RunResult> =>
    box.run(id, ["sh", "-c", script, "sh", ...args], { timeoutSeconds: boxCommands.fileSeconds, ...(stdin === undefined ? {} : { stdin }), ...(context.abortSignal ? { signal: context.abortSignal } : {}) })

  const done = async (script: string, args: string[], file: string, context: Context, stdin?: string | Uint8Array): Promise<Result<void, FileError>> => {
    if (context.abortSignal?.aborted) return abortedFile(file)
    const result = await sh(script, args, context, stdin)
    return result.exitCode === 0 ? ok(undefined) : err(fileErrorOf(result.stderr, file))
  }

  async function fileInfo(file: string, context: Context): Promise<Result<FileInfo, FileError>> {
    const target = resolve(file)
    if (context.abortSignal?.aborted) return abortedFile(target)
    const result = await sh(`stat -c '${statFormat}' -- "$1"`, [target], context)
    if (result.exitCode !== 0) return err(fileErrorOf(result.stderr, target))
    const info = statLine(result.stdout.trim())
    return info ? ok(info) : err(new FileError("unknown", `Could not read the details of ${target}`, target))
  }

  async function readBinaryFile(file: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const target = resolve(file)
    if (context.abortSignal?.aborted) return abortedFile(target)
    const bytes = await box.readFile(id, target)
    if (bytes) return ok(bytes)
    const info = await fileInfo(target, context)
    if (!info.ok) return info
    return err(new FileError(info.value.kind === "directory" ? "is_directory" : "permission_denied", `Could not read ${target}`, target))
  }

  async function readTextFile(file: string, context: Context): Promise<Result<string, FileError>> {
    const bytes = await readBinaryFile(file, context)
    return bytes.ok ? ok(decoder.decode(bytes.value)) : bytes
  }

  async function listDir(dir: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    const target = resolve(dir)
    if (context.abortSignal?.aborted) return abortedFile(target)
    const script = `[ -d "$1" ] || { [ -e "$1" ] && echo "$1: Not a directory" >&2 || echo "$1: No such file or directory" >&2; exit 1; }; for f in "$1"/* "$1"/.[!.]* "$1"/..?*; do { [ -e "$f" ] || [ -L "$f" ]; } && stat -c '${statFormat}' -- "$f"; done; exit 0`
    const result = await sh(script, [target], context)
    if (result.exitCode !== 0) return err(fileErrorOf(result.stderr, target))
    return ok(result.stdout.split("\n").flatMap((line) => statLine(line) ?? []))
  }

  async function exec(command: string | readonly string[], execOptions: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "aborted"))
    const argv = typeof command === "string" ? ["bash", "-c", command] : [...command]
    if (!argv.length || !argv[0]) return err(new ExecutionError("spawn_error", "No program to run"))
    const timeout = Math.min(execOptions?.timeout ?? boxCommands.defaultSeconds, boxCommands.maxSeconds)
    const result = await box.run(id, argv, {
      cwd: execOptions?.cwd ? resolve(execOptions.cwd) : cwd,
      env: execOptions?.env ?? {},
      timeoutSeconds: timeout,
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
    })
    if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "aborted"))
    if (result.timedOut) return err(new ExecutionError("timeout", `Command timed out after ${timeout} seconds`))
    if (typeof command !== "string" && result.exitCode === 127 && /No such file|not found|failed to execute/i.test(result.stderr)) return err(new ExecutionError("spawn_error", result.stderr.trim()))
    try {
      if (result.stdout) execOptions?.onOutput?.(result.stdout, context, { stream: "stdout" })
      if (result.stderr) execOptions?.onOutput?.(result.stderr, context, { stream: "stderr" })
    } catch (error) {
      return err(new ExecutionError("callback_error", error instanceof Error ? error.message : String(error)))
    }
    return ok({ exitCode: result.exitCode })
  }

  return {
    id: `box:${id}`,
    cwd,
    absolutePath: async (file) => ok(resolve(file)),
    joinPath: async (parts) => ok(posix.join(...parts)),
    readTextFile,
    readBinaryFile,
    async openTextLineReader(file, context) {
      const text = await readTextFile(file, context)
      if (!text.ok) return text
      const { lines, endsWithNewline } = splitLines(text.value)
      return ok(linesReader(lines, endsWithNewline))
    },
    async readTextLines(file, readOptions, context) {
      const text = await readTextFile(file, context)
      if (!text.ok) return text
      const { lines } = splitLines(text.value)
      return ok(readOptions?.maxLines === undefined ? lines : lines.slice(0, readOptions.maxLines))
    },
    async openBinaryReader(file, readOptions, context) {
      const target = resolve(file)
      const info = await fileInfo(target, context)
      if (!info.ok) return info
      if (info.value.kind === "directory") return err(new FileError("is_directory", `${target} is a directory`, target))
      if (info.value.kind === "symlink" && readOptions?.noFollow) return err(new FileError("invalid", `${target} is a symbolic link`, target))
      const bytes = await readBinaryFile(target, context)
      if (!bytes.ok) return bytes
      return ok(bytesReader({ ...info.value, kind: "file", size: bytes.value.byteLength }, bytes.value))
    },
    async writeFile(file, content, context) {
      const target = resolve(file)
      if (context.abortSignal?.aborted) return abortedFile(target)
      try {
        await box.writeFile(id, target, content)
        return ok(undefined)
      } catch (error) {
        return err(fileErrorOf(error instanceof Error ? error.message : String(error), target))
      }
    },
    appendFile: (file, content, context) => done('mkdir -p "$(dirname "$1")" && cat >> "$1"', [resolve(file)], resolve(file), context, typeof content === "string" ? encoder.encode(content) : content),
    truncateFile: (file, size, context) => done('truncate -s "$2" -- "$1"', [resolve(file), String(size)], resolve(file), context),
    flushFile: (file, context) => done('[ -e "$1" ] || { echo "$1: No such file or directory" >&2; exit 1; }; sync', [resolve(file)], resolve(file), context),
    renameFile: (from, to, context) => done('mv -f -- "$1" "$2"', [resolve(from), resolve(to)], resolve(from), context),
    fileInfo,
    listDir,
    async openDirReader(dir, context) {
      const entries = await listDir(dir, context)
      return entries.ok ? ok(pagedReader(entries.value)) : entries
    },
    async watch(_targets: readonly WatchTarget[], _onChange: (change: FileChange) => void): Promise<Result<FileWatcher, FileError>> {
      return err(new FileError("not_supported", "A box cannot watch files"))
    },
    async canonicalPath(file, context) {
      const target = resolve(file)
      if (context.abortSignal?.aborted) return abortedFile(target)
      const result = await sh('[ -e "$1" ] || { echo "$1: No such file or directory" >&2; exit 1; }; realpath -- "$1"', [target], context)
      return result.exitCode === 0 ? ok(result.stdout.trim()) : err(fileErrorOf(result.stderr, target))
    },
    async exists(file, context) {
      const info = await fileInfo(file, context)
      if (info.ok) return ok(true)
      return info.error.code === "not_found" ? ok(false) : info
    },
    createDir: (dir, dirOptions, context) => done(dirOptions?.recursive === false ? 'mkdir -- "$1"' : 'mkdir -p -- "$1"', [resolve(dir)], resolve(dir), context),
    remove: (file, removeOptions, context) =>
      done(`rm ${removeOptions?.recursive ? "-r" : ""} ${removeOptions?.force ? "-f" : ""} -- "$1"`, [resolve(file)], resolve(file), context),
    async createTempDir(prefix, context) {
      if (context.abortSignal?.aborted) return abortedFile()
      const result = await sh('mktemp -d "/tmp/$1XXXXXX"', [prefix ?? "tmp-"], context)
      return result.exitCode === 0 ? ok(result.stdout.trim()) : err(fileErrorOf(result.stderr, "/tmp"))
    },
    async createTempFile(tempOptions, context) {
      if (context.abortSignal?.aborted) return abortedFile()
      const result = await sh('f="$(mktemp "/tmp/$1XXXXXX")" && mv "$f" "$f$2" && echo "$f$2"', [tempOptions?.prefix ?? "tmp-", tempOptions?.suffix ?? ""], context)
      return result.exitCode === 0 ? ok(result.stdout.trim()) : err(fileErrorOf(result.stderr, "/tmp"))
    },
    exec,
    cleanup: async () => undefined,
  }
}
