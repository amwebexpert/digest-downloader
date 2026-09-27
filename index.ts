import { Downloader as NativeDownloader } from "./native/binding.js";
import type { DownloadProgress as NativeDownloadProgress } from "./native/binding.js";

export interface Credentials {
  username: string;
  password: string;
}

export interface DownloadProgress {
  bytes: number;
  totalBytes: number;
}

export interface DownloadOptions {
  credentials: Credentials;
  resourceUrl: string;
  destinationPath: string;
  retries?: number;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Native error codes surfaced by the Rust downloader. Encoded as a
 * `"CODE: message"` prefix on the rejected error's `message` (see
 * `src/error.rs`); this is the stable, public branching surface — use
 * `err.code`, not the message text, to distinguish failure kinds.
 */
export type DownloaderErrorCode =
  | "HttpError"
  | "AuthError"
  | "NetworkError"
  | "TimeoutError"
  | "FilesystemError"
  | "Cancelled"
  | "InvalidConfig"
  | "Unknown";

export class DownloaderError extends Error {
  readonly code: DownloaderErrorCode;

  constructor(code: DownloaderErrorCode, message: string) {
    super(message);
    this.name = "DownloaderError";
    this.code = code;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "HttpError",
  "AuthError",
  "NetworkError",
  "TimeoutError",
  "FilesystemError",
  "Cancelled",
  "InvalidConfig",
]);

function translateError(err: unknown): DownloaderError {
  const message = err instanceof Error ? err.message : String(err);
  const separatorIndex = message.indexOf(": ");
  if (separatorIndex > 0) {
    const code = message.slice(0, separatorIndex);
    if (KNOWN_CODES.has(code)) {
      return new DownloaderError(code as DownloaderErrorCode, message.slice(separatorIndex + 2));
    }
  }
  return new DownloaderError("Unknown", message);
}

export class Downloader {
  #native = new NativeDownloader();

  async download(options: DownloadOptions): Promise<void> {
    const { onProgress, credentials, resourceUrl, destinationPath, retries } = options;

    try {
      await this.#native.download(
        { credentials, resourceUrl, destinationPath, retries },
        onProgress
          ? (progress: NativeDownloadProgress) => onProgress(progress)
          : undefined,
      );
    } catch (err) {
      throw translateError(err);
    }
  }

  cancel(): void {
    this.#native.cancel();
  }
}
