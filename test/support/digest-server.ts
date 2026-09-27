import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

export interface DigestUser {
  username: string;
  password: string;
}

export interface TestServerOptions {
  realm?: string;
  users: DigestUser[];
  /** Number of authenticated hits to `/flaky` that should fail with 500 before it succeeds. */
  flakyFailuresBeforeSuccess?: number;
}

export interface TestServerHandle {
  url: string;
  /** Requests to `path` that were rejected with a 401 challenge (no/invalid Authorization). */
  probeRequestCount(path: string): number;
  /** Requests to `path` that reached the route handler with a validated Authorization header. */
  authedRequestCount(path: string): number;
  close(): Promise<void>;
}

const REALM_DEFAULT = "digest-downloader-test";
const NONCE = randomBytes(16).toString("hex");
const KNOWN_BODY = Buffer.from("x".repeat(4096), "utf8");

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function parseAuthorization(header: string | undefined): Record<string, string> | undefined {
  if (!header || !header.startsWith("Digest ")) return undefined;
  const params: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(header.slice("Digest ".length))) !== null) {
    params[match[1]] = match[2] ?? match[3];
  }
  return params;
}

function verifyDigest(
  params: Record<string, string>,
  method: string,
  user: DigestUser,
  realm: string,
): boolean {
  const ha1 = md5(`${user.username}:${realm}:${user.password}`);
  const ha2 = md5(`${method}:${params.uri}`);
  const expected = md5(
    `${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`,
  );
  return expected === params.response;
}

export async function startTestServer(opts: TestServerOptions): Promise<TestServerHandle> {
  const realm = opts.realm ?? REALM_DEFAULT;
  const flakyThreshold = opts.flakyFailuresBeforeSuccess ?? 2;

  const probeCounts = new Map<string, number>();
  const authedCounts = new Map<string, number>();
  const flakyAuthedHits = { count: 0 };

  function bump(counts: Map<string, number>, path: string) {
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  function challenge(res: ServerResponse) {
    const header = `Digest realm="${realm}", qop="auth", nonce="${NONCE}", algorithm=MD5`;
    res.writeHead(401, { "WWW-Authenticate": header });
    res.end();
  }

  function authenticate(req: IncomingMessage, path: string): DigestUser | undefined {
    const params = parseAuthorization(req.headers.authorization);
    if (!params) {
      bump(probeCounts, path);
      return undefined;
    }
    const user = opts.users.find((u) => u.username === params.username);
    if (!user || !verifyDigest(params, req.method ?? "GET", user, realm)) {
      bump(probeCounts, path);
      return undefined;
    }
    bump(authedCounts, path);
    return user;
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/not-found") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const user = authenticate(req, path);
    if (!user) {
      challenge(res);
      return;
    }

    if (path === "/known-length") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(KNOWN_BODY.length),
      });
      res.end(KNOWN_BODY);
      return;
    }

    if (path === "/unknown-length") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const chunkSize = 512;
      for (let offset = 0; offset < KNOWN_BODY.length; offset += chunkSize) {
        res.write(KNOWN_BODY.subarray(offset, offset + chunkSize));
      }
      res.end();
      return;
    }

    if (path === "/flaky") {
      flakyAuthedHits.count += 1;
      if (flakyAuthedHits.count <= flakyThreshold) {
        res.writeHead(500);
        res.end("temporary failure");
        return;
      }
      res.writeHead(200, { "Content-Length": "5" });
      res.end("hello");
      return;
    }

    if (path === "/slow-large") {
      const totalChunks = 64;
      const chunkSize = 1024 * 1024; // 64 MiB total, generated on the fly
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const source = Readable.from(
        (async function* () {
          for (let i = 0; i < totalChunks; i++) {
            yield Buffer.alloc(chunkSize, i % 256);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        })(),
      );
      source.pipe(res);
      return;
    }

    res.writeHead(404);
    res.end("unknown route");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to determine test server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    probeRequestCount: (path) => probeCounts.get(path) ?? 0,
    authedRequestCount: (path) => authedCounts.get(path) ?? 0,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
