import { Downloader as NativeDownloader } from "./native/binding.js";
export class DownloaderError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DownloaderError";
        this.code = code;
    }
}
const KNOWN_CODES = new Set([
    "HttpError",
    "AuthError",
    "NetworkError",
    "TimeoutError",
    "FilesystemError",
    "Cancelled",
    "InvalidConfig",
]);
const translateError = (err) => {
    const message = err instanceof Error ? err.message : String(err);
    const separatorIndex = message.indexOf(": ");
    if (separatorIndex > 0) {
        const code = message.slice(0, separatorIndex);
        if (KNOWN_CODES.has(code)) {
            return new DownloaderError(code, message.slice(separatorIndex + 2));
        }
    }
    return new DownloaderError("Unknown", message);
};
export class Downloader {
    #native = new NativeDownloader();
    async download(options) {
        const { onProgress, credentials, resourceUrl, destinationPath, retries } = options;
        try {
            await this.#native.download({ credentials, resourceUrl, destinationPath, retries }, onProgress
                ? (progress) => onProgress(progress)
                : undefined);
        }
        catch (err) {
            throw translateError(err);
        }
    }
    cancel() {
        this.#native.cancel();
    }
}
