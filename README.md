- [digest-downloader](#digest-downloader)
  - [Requirements](#requirements)
  - [Build](#build)
  - [Windows 11 build](#windows-11-build)
  - [Test](#test)
  - [Try it from the command line](#try-it-from-the-command-line)
  - [API](#api)
  - [Design notes](#design-notes)

# digest-downloader

Native Node.js file downloader written in Rust (napi-rs). Streams a
digest-auth-protected resource straight to disk with retry, cancellation, and
byte-level progress — the full body never crosses into the Node process.

## Requirements

- Rust toolchain (stable) + Cargo
- Node.js
- [bun](https://bun.sh) for installing JS dependencies

## Build

```bash
bun install
bun run build   # compiles the Rust native addon into native/
```

`bun run build` is required before running tests or the example — `tsx`
transpiles/loads the TypeScript layer only, it does not compile Rust.

## Windows 11 build

One-time setup:

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install OpenJS.NodeJS.LTS
powershell -c "irm bun.sh/install.ps1 | iex"
rustup default stable-msvc
```

Build + test (same commands as macOS/Linux):

```powershell
bun install
bun run build
bun run test
```

Notes:

- MSVC Build Tools (C++ workload) is required for the linker — `stable-gnu` toolchain won't link napi-rs addons.
- No OpenSSL/vcpkg setup needed — `reqwest` uses `rustls`, not the system TLS stack.
- Output artifact: `native/digest-downloader.win32-x64-msvc.node` (not an `.exe` — it's a native addon, loaded via `require`/`import`, not run directly).
- Restart the terminal after installing rustup/bun so `PATH` picks them up.

## Test

```bash
bun run test          # tsx --test test/*.test.ts
bun run test:watch    # same, with --watch
```

Tests spin up a local HTTP server (`test/support/digest-server.ts`) that
implements RFC 2617/7616 Digest Authentication and deliberately injects
failures (500s, 404s, slow/large bodies) to exercise retry, cancellation, and
streaming behavior without hitting a real network resource.

## Try it from the command line

```bash
bun run example -- --url https://example.com/file.asf \
  --user someuser --pass somepassword \
  --dest /tmp/file.asf --retries 2
```

Prints a live progress line, Ctrl+C cancels the in-flight download cleanly
(exit code `130`).

## API

```ts
import { Downloader } from "./index.js";

const downloader = new Downloader();

await downloader.download({
  credentials: { username: "user", password: "password" },
  resourceUrl: "https://example.com/file.asf",
  destinationPath: "/tmp/file.asf",
  retries: 2,
  onProgress: ({ bytes, totalBytes }) => console.log(`${bytes}/${totalBytes}`),
});
```

`totalBytes` is `-1` when the server doesn't send `Content-Length`.

Cancellation:

```ts
const promise = downloader.download(options);
setTimeout(() => downloader.cancel(), 5000);
await promise;
```

Errors are `DownloaderError` instances with a stable `.code`:
`HttpError | AuthError | NetworkError | TimeoutError | FilesystemError | Cancelled | InvalidConfig`.

## Design notes

- Downloads write to a `<destinationPath>.part` sibling file, renamed atomically
  on success. On failure or cancellation the partial file is removed rather than
  left half-written, so a failed run never leaves a misleadingly complete file.
- Retries restart the download from zero (no Range/resume support yet).
  Retryable: network errors, timeouts, HTTP 5xx. Not retried: 4xx, auth
  failures, filesystem errors, or cancellation.
- Retries have no backoff/delay in this version — a real flaky network will be
  hit up to `retries + 1` times back to back.
- One in-flight download per `Downloader` instance — calling `download()`
  again while one is active rejects with `InvalidConfig` rather than silently
  breaking `cancel()`'s target. Use separate instances for concurrent downloads.
