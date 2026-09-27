import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Downloader, DownloaderError } from "../index.js";
import { startTestServer, type TestServerHandle } from "./support/digest-server.js";

const CREDENTIALS = { username: "alice", password: "wonderland" };

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "digest-downloader-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test("retries after a transient 500 and eventually succeeds", async () => {
  const server = await startTestServer({ users: [CREDENTIALS], flakyFailuresBeforeSuccess: 1 });
  try {
    const destinationPath = join(tmpDir, "flaky-success.bin");
    const downloader = new Downloader();

    await downloader.download({
      credentials: CREDENTIALS,
      resourceUrl: `${server.url}/flaky`,
      destinationPath,
      retries: 2,
    });

    assert.equal(server.authedRequestCount("/flaky"), 2);
  } finally {
    await server.close();
  }
});

test("does not retry a 404", async () => {
  const server = await startTestServer({ users: [CREDENTIALS] });
  try {
    const destinationPath = join(tmpDir, "not-found.bin");
    const downloader = new Downloader();

    await assert.rejects(
      downloader.download({
        credentials: CREDENTIALS,
        resourceUrl: `${server.url}/not-found`,
        destinationPath,
        retries: 2,
      }),
      (err: unknown) => {
        assert.ok(err instanceof DownloaderError);
        assert.equal(err.code, "HttpError");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("retries exactly `retries` times before giving up", async () => {
  const server = await startTestServer({ users: [CREDENTIALS], flakyFailuresBeforeSuccess: 3 });
  try {
    const destinationPath = join(tmpDir, "flaky-exhausted.bin");
    const downloader = new Downloader();

    await assert.rejects(
      downloader.download({
        credentials: CREDENTIALS,
        resourceUrl: `${server.url}/flaky`,
        destinationPath,
        retries: 2,
      }),
      (err: unknown) => {
        assert.ok(err instanceof DownloaderError);
        assert.equal(err.code, "HttpError");
        return true;
      },
    );

    assert.equal(server.authedRequestCount("/flaky"), 3);
  } finally {
    await server.close();
  }
});
