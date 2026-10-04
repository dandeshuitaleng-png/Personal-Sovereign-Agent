import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  canonical,
  checkSignature,
  decrypt,
  derive,
  encrypt,
  keyId,
  keyPair,
  signature,
  type Envelope,
} from "./crypto.js";
import type { SecretIdentity } from "../shared/types.js";

interface VaultConfig {
  version: 1;
  salt: string;
  wrappedKey: Envelope;
}
interface Backup {
  version: 1;
  salt: string;
  payload: Envelope;
}
const kinds = new Set([
  "identity",
  "model",
  "source",
  "memory",
  "grant",
  "task",
  "artifact",
]);
export class Vault {
  db: DatabaseSync;
  private key?: Buffer;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "vault.sqlite"));
    const version = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > 1) {
      this.db.close();
      throw new Error(
        "This vault was created by a newer PSA version. Use that version to open it.",
      );
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,blob TEXT NOT NULL, PRIMARY KEY(kind,id)); PRAGMA user_version=1;",
    );
  }
  get initialized() {
    return !!this.db.prepare("SELECT value FROM meta WHERE key=?").get("vault");
  }
  get unlocked() {
    return !!this.key;
  }
  private requireKey() {
    if (!this.key) throw new Error("Vault is locked. Unlock it to continue.");
    return this.key;
  }
  setup(
    password: string,
    records?: { kind: string; id: string; value: unknown }[],
  ) {
    if (this.initialized) throw new Error("A vault already exists.");
    if (password.length < 12)
      throw new Error("Use a passphrase with at least 12 characters.");
    const salt = randomBytes(16).toString("base64");
    const key = randomBytes(32);
    const derived = derive(password, salt);
    const config: VaultConfig = {
      version: 1,
      salt,
      wrappedKey: encrypt(key.toString("base64"), derived, "psa-vault-v1"),
    };
    derived.fill(0);
    const owner = keyPair(),
      agent = keyPair();
    const now = new Date().toISOString();
    const identity: SecretIdentity = {
      ownerId: keyId(owner.publicKey),
      agentId: keyId(agent.publicKey),
      ownerPublicKey: owner.publicKey,
      ownerPrivateKey: owner.privateKey,
      agentPublicKey: agent.publicKey,
      agentPrivateKey: agent.privateKey,
      createdAt: now,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO meta VALUES(?,?)")
        .run("vault", JSON.stringify(config));
      this.key = key;
      if (records) for (const r of records) this.put(r.kind, r.id, r.value);
      else this.put("identity", "primary", identity);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      this.lock();
      throw e;
    }
  }
  unlock(password: string) {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key=?")
      .get("vault") as { value: string } | undefined;
    if (!row) throw new Error("Create or restore a vault first.");
    const config = JSON.parse(row.value) as VaultConfig;
    const derived = derive(password, config.salt);
    try {
      const key = Buffer.from(
        decrypt(config.wrappedKey, derived, "psa-vault-v1"),
        "base64",
      );
      const identity = this.db
        .prepare("SELECT blob FROM records WHERE kind=? AND id=?")
        .get("identity", "primary") as { blob: string };
      decrypt(JSON.parse(identity.blob), key, "identity:primary");
      this.key?.fill(0);
      this.key = key;
    } catch {
      throw new Error("The passphrase is incorrect or the vault is damaged.");
    } finally {
      derived.fill(0);
    }
  }
  lock() {
    this.key?.fill(0);
    this.key = undefined;
  }
  get<T>(kind: string, id: string): T | undefined {
    const key = this.requireKey();
    const row = this.db
      .prepare("SELECT blob FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { blob: string } | undefined;
    return row
      ? JSON.parse(decrypt(JSON.parse(row.blob), key, kind + ":" + id))
      : undefined;
  }
  list<T>(kind: string): T[] {
    const key = this.requireKey();
    const rows = this.db
      .prepare("SELECT id,blob FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind) as { id: string; blob: string }[];
    return rows.map((r) =>
      JSON.parse(decrypt(JSON.parse(r.blob), key, kind + ":" + r.id)),
    );
  }
  put(kind: string, id: string, value: unknown) {
    if (!kinds.has(kind)) throw new Error("Unsupported record type.");
    const blob = JSON.stringify(
      encrypt(JSON.stringify(value), this.requireKey(), kind + ":" + id),
    );
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET blob=excluded.blob",
      )
      .run(kind, id, blob);
  }
  remove(kind: string, id: string) {
    this.requireKey();
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  identity() {
    return this.get<SecretIdentity>("identity", "primary")!;
  }
  export(password: string): Backup {
    if (password.length < 12)
      throw new Error("Use a backup passphrase with at least 12 characters.");
    const key = this.requireKey();
    const rows = this.db
      .prepare("SELECT kind,id,blob FROM records ORDER BY kind,id")
      .all() as { kind: string; id: string; blob: string }[];
    const records = rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      value: JSON.parse(decrypt(JSON.parse(r.blob), key, r.kind + ":" + r.id)),
    }));
    const salt = randomBytes(16).toString("base64"),
      derived = derive(password, salt);
    try {
      return {
        version: 1,
        salt,
        payload: encrypt(
          JSON.stringify({ version: 1, records }),
          derived,
          "psa-backup-v1",
        ),
      };
    } finally {
      derived.fill(0);
    }
  }
  restore(backup: Backup, password: string) {
    if (this.initialized)
      throw new Error(
        "Restore requires an empty vault. Start with a separate data directory.",
      );
    if (
      backup.version !== 1 ||
      typeof backup.salt !== "string" ||
      !backup.payload
    )
      throw new Error("Unsupported backup format.");
    let data: {
      version: number;
      records: { kind: string; id: string; value: unknown }[];
    };
    const derived = derive(password, backup.salt);
    try {
      data = JSON.parse(decrypt(backup.payload, derived, "psa-backup-v1"));
    } catch {
      throw new Error(
        "The backup passphrase is incorrect or the backup is damaged.",
      );
    } finally {
      derived.fill(0);
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.records) ||
      data.records.length > 100000
    )
      throw new Error("Unsupported backup contents.");
    const seen = new Set<string>();
    for (const r of data.records) {
      const id = r.kind + ":" + r.id;
      if (
        !kinds.has(r.kind) ||
        typeof r.id !== "string" ||
        seen.has(id) ||
        !r.value ||
        typeof r.value !== "object"
      )
        throw new Error("Invalid backup record.");
      seen.add(id);
    }
    const ident = data.records.find(
      (r) => r.kind === "identity" && r.id === "primary",
    )?.value as SecretIdentity | undefined;
    if (
      !ident ||
      ident.agentId !== keyId(ident.agentPublicKey) ||
      ident.ownerId !== keyId(ident.ownerPublicKey) ||
      !checkSignature(
        "restore",
        signature("restore", ident.agentPrivateKey),
        ident.agentPublicKey,
      ) ||
      !checkSignature(
        "restore",
        signature("restore", ident.ownerPrivateKey),
        ident.ownerPublicKey,
      )
    )
      throw new Error("Invalid backup identity.");
    this.setup(password, data.records);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.lock();
    this.db.close();
  }
}
