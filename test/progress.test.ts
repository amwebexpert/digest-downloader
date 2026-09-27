import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Downloader, type DownloadProgress } from "../index.js";
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

test("progress callback receives monotonically increasing byte counts", async () => {
  const destinationPath = join(tmpDir, "progress-known.bin");
  const downloader = new Downloader();
  const ticks: DownloadProgress[] = [];

  await downloader.download({
    credentials: CREDENTIALS,
    resourceUrl: `${server.url}/known-length`,
    destinationPath,
    onProgress: (progress) => ticks.push(progress),
  });

  assert.ok(ticks.length > 0, "expected at least one progress tick");
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i]!.bytes >= ticks[i - 1]!.bytes);
  }
  assert.equal(ticks.at(-1)!.bytes, 4096);
});

test("totalBytes matches Content-Length when the server provides one", async () => {
  const destinationPath = join(tmpDir, "progress-content-length.bin");
  const downloader = new Downloader();
  const ticks: DownloadProgress[] = [];

  await downloader.download({
    credentials: CREDENTIALS,
    resourceUrl: `${server.url}/known-length`,
    destinationPath,
    onProgress: (progress) => ticks.push(progress),
  });

  assert.ok(ticks.length > 0);
  for (const tick of ticks) {
    assert.equal(tick.totalBytes, 4096);
  }
});

test("totalBytes is -1 when the server does not send Content-Length", async () => {
  const destinationPath = join(tmpDir, "progress-unknown-length.bin");
  const downloader = new Downloader();
  const ticks: DownloadProgress[] = [];

  await downloader.download({
    credentials: CREDENTIALS,
    resourceUrl: `${server.url}/unknown-length`,
    destinationPath,
    onProgress: (progress) => ticks.push(progress),
  });

  assert.ok(ticks.length > 0);
  for (const tick of ticks) {
    assert.equal(tick.totalBytes, -1);
  }
});
