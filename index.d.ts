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
export type DownloaderErrorCode = "HttpError" | "AuthError" | "NetworkError" | "TimeoutError" | "FilesystemError" | "Cancelled" | "InvalidConfig" | "Unknown";
export declare class DownloaderError extends Error {
    readonly code: DownloaderErrorCode;
    constructor(code: DownloaderErrorCode, message: string);
}
export declare class Downloader {
    #private;
    download(options: DownloadOptions): Promise<void>;
    cancel(): void;
}
