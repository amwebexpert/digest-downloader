import { parseArgs } from "node:util";

import { Downloader } from "../index.js";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    user: { type: "string" },
    pass: { type: "string" },
    dest: { type: "string" },
    retries: { type: "string", default: "2" },
  },
});

if (!values.url || !values.user || !values.pass || !values.dest) {
  console.error(
    "Usage: tsx examples/download.ts --url <url> --user <user> --pass <pass> --dest <path> [--retries <n>]",
  );
  process.exit(2);
}

const downloader = new Downloader();
let cancelRequested = false;

process.on("SIGINT", () => {
  if (cancelRequested) {
    process.exit(130);
  }
  cancelRequested = true;
  process.stderr.write("\nCancelling...\n");
  downloader.cancel();
});

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)}${units[unitIndex]}`;
}

let lastLineLength = 0;

function renderProgress(bytes: number, totalBytes: number): void {
  const line =
    totalBytes >= 0
      ? `\r${formatBytes(bytes)} / ${formatBytes(totalBytes)}  ${((bytes / totalBytes) * 100).toFixed(1)}%`
      : `\r${formatBytes(bytes)}  (size unknown)`;
  process.stdout.write(line.padEnd(lastLineLength));
  lastLineLength = line.length;
}

try {
  await downloader.download({
    credentials: { username: values.user, password: values.pass },
    resourceUrl: values.url,
    destinationPath: values.dest,
    retries: Number(values.retries),
    onProgress: ({ bytes, totalBytes }) => renderProgress(bytes, totalBytes),
  });
  process.stdout.write("\n");
  console.log(`Done -> ${values.dest}`);
  process.exit(0);
} catch (err) {
  process.stdout.write("\n");
  const code = (err as { code?: string }).code;
  if (code === "Cancelled") {
    console.error("Download cancelled.");
    process.exit(130);
  }
  console.error(`Download failed [${code ?? "Unknown"}]: ${(err as Error).message ?? err}`);
  process.exit(1);
}
