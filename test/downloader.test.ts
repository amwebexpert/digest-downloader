import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { Downloader, DownloaderError } from "../index.js";
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

test("downloads a digest-auth-protected resource successfully", async () => {
  const destinationPath = join(tmpDir, "known-length.bin");
  const downloader = new Downloader();

  await downloader.download({
    credentials: CREDENTIALS,
    resourceUrl: `${server.url}/known-length`,
    destinationPath,
  });

  const contents = await readFile(destinationPath);
  assert.equal(contents.length, 4096);
  assert.ok(contents.every((byte) => byte === "x".charCodeAt(0)));
});

test("rejects with AuthError for invalid credentials", async () => {
  const destinationPath = join(tmpDir, "bad-creds.bin");
  const downloader = new Downloader();

  await assert.rejects(
    downloader.download({
      credentials: { username: "alice", password: "wrong-password" },
      resourceUrl: `${server.url}/known-length`,
      destinationPath,
      retries: 0,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DownloaderError);
      assert.equal(err.code, "AuthError");
      return true;
    },
  );
});

test("rejects with FilesystemError when the destination directory does not exist", async () => {
  const destinationPath = join(tmpDir, "no-such-dir", "file.bin");
  const downloader = new Downloader();

  await assert.rejects(
    downloader.download({
      credentials: CREDENTIALS,
      resourceUrl: `${server.url}/known-length`,
      destinationPath,
      retries: 0,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DownloaderError);
      assert.equal(err.code, "FilesystemError");
      return true;
    },
  );
});
