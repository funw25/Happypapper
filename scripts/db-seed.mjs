/**
 * Creates the local accounts and the starter banned-word list.
 * Safe to re-run: existing rows are left untouched.
 *
 * Works on both backends; see scripts/lib/db-client.mjs.
 */
import bcrypt from "bcryptjs";
import { describeBackend, openRawClient } from "./lib/db-client.mjs";

const client = await openRawClient();
console.log(`目标：${describeBackend()}`);

const accounts = [
  { email: "admin@happypaper.local", name: "admin", password: "admin12345", role: "admin" },
  { email: "reader@happypaper.local", name: "reader", password: "reader12345", role: "user" },
  // The two named administrators required by docs/03-requirements.md section 2.3.
  // The requirement fixes only the display name; the email is the ASCII form of it.
  { email: "florence@happypaper.com", name: "Florence", password: "florence12345", role: "admin" },
  { email: "alpha@happypaper.com", name: "α", password: "alpha12345", role: "admin" },
];

for (const account of accounts) {
  const exists = await client.query(`select 1 from "users" where "email" = $1`, [account.email]);
  if (exists.rows.length > 0) {
    console.log(`skip ${account.email} (exists)`);
    continue;
  }
  const passwordHash = await bcrypt.hash(account.password, 10);
  await client.query(
    `insert into "users" ("email", "name", "password_hash", "role") values ($1, $2, $3, $4)`,
    [account.email, account.name, passwordHash, account.role],
  );
  console.log(`created ${account.email} / ${account.password}`);
}

const words = ["广告", "代写", "加微信", "私聊", "刷单"];
for (const word of words) {
  await client.query(`insert into "banned_words" ("word") values ($1) on conflict do nothing`, [word]);
}
console.log(`banned words: ${words.length}`);

await client.close();
