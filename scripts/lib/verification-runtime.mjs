import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";

const password = randomBytes(18).toString("hex");

async function getPort() {
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  const closed = once(listener, "close");
  listener.close();
  await closed;
  return port;
}

async function run(script, env) {
  const child = spawn(process.execPath, [script], { env, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(script + " exited with " + code);
}

export async function withVerificationRuntime(verify, { seed } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "happypaper-v1-"));
  await mkdir(resolve(".verify"), { recursive: true });
  const existingBuild = process.env.HAPPYPAPER_TEST_NEXT_BUILD;
  const nextDir = existingBuild ? resolve(existingBuild) : await mkdtemp(resolve(".verify", "next-"));
  const tsconfig = existingBuild ? null : "tsconfig.happypaper-test-" + basename(nextDir) + ".json";
  const port = await getPort();
  const base = "http://127.0.0.1:" + port;
  const env = {
    ...process.env,
    DATABASE_URL: "",
    PGLITE_DATA_DIR: join(dir, "db"),
    STORAGE_DRIVER: "local",
    STORAGE_DIR: join(dir, "files"),
    AUTH_URL: base,
    NEXTAUTH_URL: base,
    APP_URL: base,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    HAPPYPAPER_NEXT_DIST_DIR: relative(process.cwd(), nextDir).replaceAll("\\", "/"),
    HAPPYPAPER_NEXT_TSCONFIG: tsconfig ?? "tsconfig.json",
    AUTH_GITHUB_ID: "",
    AUTH_GITHUB_SECRET: "",
    SMTP_URL: "",
  };

  await run("scripts/db-migrate.mjs", env);

  const roles = [
    ["reader-a", "user", true, false],
    ["reader-b", "user", true, false],
    ["unverified-reader", "user", false, false],
    ["test-admin", "admin", true, false],
    ["muted-reader", "user", true, true],
  ];
  const actors = {};
  const client = new PGlite(env.PGLITE_DATA_DIR);
  try {
    const hash = await bcrypt.hash(password, 10);
    for (const [name, role, verified, muted] of roles) {
      const email = name + "@happypaper.test";
      await client.query(
        "insert into users (email, name, password_hash, role, email_verified, muted_until) values ($1, $2, $3, $4, $5, $6)",
        [email, name, hash, role, verified ? new Date() : null, muted ? new Date(Date.now() + 3_600_000) : null],
      );
      actors[name] = { email, password, name };
    }
    await seed?.(client, env.STORAGE_DIR);
  } finally {
    await client.close();
  }

  if (tsconfig) await writeFile(tsconfig, await readFile("tsconfig.json"), { flag: "wx" });
  let logs = "";
  function startServer() {
    const child = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", existingBuild ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port),
    ], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (text) => { logs = (logs + text).slice(-20_000); });
    }
    return child;
  }
  let server = startServer();
  async function ready() {
    const expiry = Date.now() + 75_000;
    while (true) {
      if (server.exitCode !== null || Date.now() > expiry) throw new Error("Local test server did not start");
      try {
        const response = await fetch(base + "/api/auth/csrf", { signal: AbortSignal.timeout(12_000) });
        if (response.ok) break;
      } catch {
        // The local server may still be starting or building the first route.
      }
      await delay(350);
    }
  }
  async function stopServer() {
    if (server.exitCode === null) {
      if (process.platform === "win32") {
        const stop = spawn("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], {
          windowsHide: true, stdio: "ignore",
        });
        await Promise.race([once(stop, "exit"), delay(2_000)]).catch(() => {});
      }
      if (server.exitCode === null) server.kill();
      await Promise.race([once(server, "exit"), delay(2_000)]).catch(() => {});
    }
    server.stdout.destroy();
    server.stderr.destroy();
    server.unref();
  }
  try {
    await ready();
    return await verify({ base, actors, logs: () => logs, restart: async () => {
      await stopServer();
      server = startServer();
      await ready();
    } });
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    await stopServer();
    if (tsconfig) await rm(tsconfig, { force: true });
  }
}
