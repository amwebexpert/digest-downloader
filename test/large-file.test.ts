import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Downloader } from "../index.js";
import { startTestServer, type TestServerHandle } from "./support/digest-server.js";

const CREDENTIALS = { username: "alice", password: "wonderland" };

let server: TestServerHandle;
let tmpDir: string;

before(async () => {
  server = await startTestServer({ users: [CREDENTIALS] });
  tmpDir = await mkdtemp(join(tmpdir(), "digest-downloader-"));
});

after(async () => {
  await server.close();
  await rm(tmpDir, { recursive: true, force: true });
});

test("streams a large file to disk without buffering it fully in the Node process", async () => {
  const destinationPath = join(tmpDir, "large.bin");
  const downloader = new Downloader();

  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);

  try {
    await downloader.download({
      credentials: CREDENTIALS,
      resourceUrl: `${server.url}/slow-large`,
      destinationPath,
    });
  } finally {
    clearInterval(sampler);
  }

  const { size } = await stat(destinationPath);
  assert.equal(size, 64 * 1024 * 1024);

  // The 64 MiB body never crosses the N-API boundary (only {bytes, totalBytes}
  // structs do), so Node's own RSS growth should be nowhere near the file size.
  const growth = peakRss - rssBefore;
  assert.ok(
    growth < 48 * 1024 * 1024,
    `expected RSS growth well under the 64 MiB payload size, grew by ${Math.round(growth / 1024 / 1024)}MiB`,
  );
});
