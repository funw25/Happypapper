/**
 * Storage preconditions for GitHub login (docs/03-requirements.md AUTH-008 to
 * AUTH-010).
 *
 *   npm run verify:github-schema      # the dev server must be STOPPED
 *
 * verify:github covers the HTTP wiring; the OAuth handshake itself needs real
 * credentials and a browser. What can still be checked is the half the callback
 * depends on: that the rows it will write on first login actually fit. A silent
 * regression here (someone making `password_hash` NOT NULL again, for example)
 * would break GitHub login with nothing to catch it.
 *
 * PGlite allows one process per data directory, so this cannot run while the dev
 * server holds it. Every statement runs inside a transaction that is rolled
 * back, leaving no rows behind.
 */
import { PGlite } from "@electric-sql/pglite";

const dataDir = process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const listening = await fetch("http://127.0.0.1:3100/login")
  .then(() => true)
  .catch(() => false);
if (listening) {
  console.error(
    "开发服务器正在占用数据目录（PGlite 同一时刻只允许一个进程）。先停掉 npm run dev 再跑本脚本。",
  );
  process.exit(2);
}

const db = new PGlite(dataDir);
await db.waitReady;

async function attempt(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

const email = `verify-github-schema-${Date.now()}@example.invalid`;
const name = `verify-github-schema-${Date.now()}`;

await db.exec("begin");

// 1. A GitHub-created account has no local password, so the column must accept
//    NULL. This is what migration 0005 changed.
const inserted = await attempt(
  `insert into "users" ("email", "name", "password_hash") values ($1, $2, null) returning "id"`,
  [email, name],
);
const userId = inserted.ok ? inserted.result.rows[0].id : null;
check(
  "可以创建没有本地密码的账号（OAuth 首登）",
  inserted.ok && Boolean(userId),
  inserted.ok ? "password_hash 接受 NULL" : inserted.error.slice(0, 120),
);

// 2. The adapter records the GitHub identity in `accounts` with the provider's
//    own account id.
const linked = await attempt(
  `insert into "accounts" ("user_id", "type", "provider", "provider_account_id")
   values ($1, 'oauth', 'github', $2) returning "provider_account_id"`,
  [userId, String(Date.now())],
);
check(
  "可以把 GitHub 身份写入 accounts",
  linked.ok,
  linked.ok ? `provider_account_id=${linked.result.rows[0].provider_account_id}` : linked.error.slice(0, 120),
);

// 3. The composite primary key is what stops one GitHub identity being linked
//    twice — two local accounts must not share a GitHub account.
await db.exec("savepoint sp_account");
const duplicateAccount = await attempt(
  `insert into "accounts" ("user_id", "type", "provider", "provider_account_id")
   values ($1, 'oauth', 'github', $2)`,
  [userId, "fixed-account-id"],
);
const duplicateAgain = await attempt(
  `insert into "accounts" ("user_id", "type", "provider", "provider_account_id")
   values ($1, 'oauth', 'github', $2)`,
  [userId, "fixed-account-id"],
);
await db.exec("rollback to savepoint sp_account");
check(
  "同一 GitHub 身份不能被重复绑定",
  duplicateAccount.ok && !duplicateAgain.ok,
  duplicateAgain.ok ? "重复插入竟然成功" : "第二次插入被主键拒绝",
);

// 4. `resolveGithubIdentity` exists because this constraint is real: a GitHub
//    display name is not unique.
await db.exec("savepoint sp_name");
const duplicateName = await attempt(
  `insert into "users" ("email", "name", "password_hash") values ($1, $2, 'x')`,
  [`other-${email}`, name],
);
await db.exec("rollback to savepoint sp_name");
check("同名账号被拒绝（昵称去重的前提）", !duplicateName.ok, duplicateName.ok ? "重名竟然成功" : "被唯一约束拒绝");

// 5. Deleting an account must take its linked identities with it.
await db.query(`delete from "users" where "id" = $1`, [userId]);
const orphan = await db.query(`select count(*)::int as n from "accounts" where "user_id" = $1`, [userId]);
check("删除账号会级联删除其 GitHub 绑定", orphan.rows[0].n === 0, `剩余 ${orphan.rows[0].n} 条`);

await db.exec("rollback");
const residue = await db.query(`select count(*)::int as n from "users" where "email" = $1`, [email]);
check("检查过程不留下数据（已回滚）", residue.rows[0].n === 0, `剩余 ${residue.rows[0].n} 条`);

await db.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((f) => f.name).join(", "));
}
process.exit(failed.length === 0 ? 0 : 1);
