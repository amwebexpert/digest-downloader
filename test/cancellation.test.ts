import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Downloader, DownloaderError } from "../index.js";
import { startTestServer } from "./support/digest-server.js";

const CREDENTIALS = { username: "alice", password: "wonderland" };

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "digest-downloader-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test("cancel() interrupts an active download", async () => {
  const server = await startTestServer({ users: [CREDENTIALS] });
  try {
    const destinationPath = join(tmpDir, "cancelled.bin");
    const downloader = new Downloader();

    const promise = downloader.download({
      credentials: CREDENTIALS,
      resourceUrl: `${server.url}/slow-large`,
      destinationPath,
    });

    setTimeout(() => downloader.cancel(), 150);

    const start = Date.now();
    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof DownloaderError);
      assert.equal(err.code, "Cancelled");
      return true;
    });
    const elapsed = Date.now() - start;

    // The full body takes ~64 * 20ms = 1.28s to stream; cancellation well
    // before that proves it interrupted the transfer rather than waiting it out.
    assert.ok(elapsed < 1000, `expected cancellation well under 1s, took ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test("cancellation does not trigger a retry", async () => {
  const server = await startTestServer({ users: [CREDENTIALS] });
  try {
    const destinationPath = join(tmpDir, "cancelled-no-retry.bin");
    const downloader = new Downloader();

    const promise = downloader.download({
      credentials: CREDENTIALS,
      resourceUrl: `${server.url}/slow-large`,
      destinationPath,
      retries: 2,
    });

    setTimeout(() => downloader.cancel(), 150);

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof DownloaderError);
      assert.equal(err.code, "Cancelled");
      return true;
    });

    assert.equal(server.authedRequestCount("/slow-large"), 1);
  } finally {
    await server.close();
  }
});
