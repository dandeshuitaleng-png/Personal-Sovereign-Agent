import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Vault } from "./vault.js";
import { Runner } from "./runner.js";
import { hash, signature } from "./crypto.js";
import {
  grantPayload,
  modelFingerprint,
  signGrant,
  verifyPackage,
} from "./authority.js";
import { extractDocument } from "./documents.js";
import { complete, parseJson, validateEndpoint } from "./model.js";
import type {
  Artifact,
  AuthorityGrant,
  MemoryEntry,
  ModelConfig,
  Source,
  Task,
  VerificationPackage,
} from "../shared/types.js";

const passwordSchema = z.object({ password: z.string().min(12).max(1024) });
const modelSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["openai", "ollama"]).default("openai"),
  name: z.string().min(1).max(80),
  baseUrl: z.string().url().max(1000),
  model: z.string().min(1).max(120),
  apiKey: z.string().max(4096).optional(),
  contextTokens: z.number().int().min(4096).max(131072).default(4096),
  outputTokens: z.number().int().min(512).max(8192).default(1024),
});
const grantSchema = z.object({
  expiresMinutes: z.number().int().min(1).max(1440).default(60),
  maxCalls: z.number().int().min(1).max(100).default(30),
});
const renewalSchema = grantSchema.extend({
  sourceIds: z.array(z.string()).max(20).optional(),
  urls: z.array(z.string().url().max(2000)).max(5).optional(),
  modelId: z.string().optional(),
});
const taskSchema = grantSchema.extend({
  idempotencyKey: z.string().min(8).max(100),
  intent: z.string().min(5).max(12000),
  language: z.enum(["English", "Chinese"]).default("English"),
  modelId: z.string(),
  sourceIds: z.array(z.string()).max(20),
  urls: z.array(z.string().url().max(2000)).max(5),
});
export async function createApp(options: {
  dataDir: string;
  modelCall?: typeof complete;
  serveWeb?: boolean;
}) {
  const vault = new Vault(options.dataDir),
    runner = new Runner(vault, options.modelCall);
  const app = Fastify({ logger: false, bodyLimit: 40 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  const sessions = new Map<string, { csrf: string; expires: number }>();
  let failures = 0,
    lastFailure = 0;
  const session = (req: { cookies: Record<string, string | undefined> }) => {
    const s = sessions.get(req.cookies.psa_session || "");
    return s && s.expires > Date.now() ? s : undefined;
  };
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const hostname = (req.headers.host || "").split(":")[0];
    if (!["localhost", "127.0.0.1"].includes(hostname))
      return reply.code(403).send({
        error: "HOST_BLOCKED",
        message: "Only local access is allowed.",
      });
    if (!req.url.startsWith("/api/")) return;
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        "http://127.0.0.1:4318",
        "http://localhost:4318",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ].includes(origin)
    )
      return reply.code(403).send({
        error: "ORIGIN_BLOCKED",
        message: "This origin is not allowed.",
      });
    const publicRoutes = [
      "/api/status",
      "/api/vault/setup",
      "/api/vault/unlock",
      "/api/vault/restore",
    ];
    if (publicRoutes.includes(req.url.split("?")[0])) return;
    const s = session(req);
    if (!s || !vault.unlocked)
      return reply
        .code(401)
        .send({ error: "LOCKED", message: "Unlock your vault to continue." });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-psa-csrf"] !== s.csrf
    )
      return reply.code(403).send({
        error: "CSRF_INVALID",
        message: "Refresh the page and try again.",
      });
  });
  app.setErrorHandler((error, _req, reply) => {
    const status = (error as { statusCode?: number }).statusCode || 400;
    const message =
      error instanceof z.ZodError
        ? "Check the entered values and try again."
        : status === 413
          ? "The upload is too large."
          : status >= 500
            ? "The request could not be completed. Check the local service."
            : error instanceof Error
              ? error.message
              : "The request could not be completed.";
    reply.code(status).send({
      error: error instanceof z.ZodError ? "INVALID_INPUT" : "REQUEST_FAILED",
      message,
    });
  });
  const establish = (reply: { setCookie: Function }) => {
    const id = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    sessions.set(id, { csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
    reply.setCookie("psa_session", id, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 43200,
    });
    return { unlocked: true, csrf };
  };
  const throttle = () => {
    if (failures >= 5 && Date.now() - lastFailure < 30000)
      throw new Error(
        "Too many unsuccessful unlock attempts. Wait 30 seconds.",
      );
  };
  const publicIdentity = () => {
    const {
      ownerPrivateKey: _,
      agentPrivateKey: __,
      ...identity
    } = vault.identity();
    return identity;
  };
  app.get("/api/status", async (req) => ({
    initialized: vault.initialized,
    unlocked: !!session(req) && vault.unlocked,
    csrf: session(req)?.csrf,
    running: runner.active?.id,
  }));
  app.post("/api/vault/setup", async (req, reply) => {
    throttle();
    const { password } = passwordSchema.parse(req.body);
    vault.setup(password);
    return establish(reply);
  });
  app.post("/api/vault/unlock", async (req, reply) => {
    throttle();
    const { password } = passwordSchema.parse(req.body);
    try {
      const wasLocked = !vault.unlocked;
      vault.unlock(password);
      failures = 0;
      if (wasLocked) runner.recover();
      return establish(reply);
    } catch (e) {
      failures++;
      lastFailure = Date.now();
      throw e;
    }
  });
  app.post("/api/vault/restore", async (req, reply) => {
    throttle();
    const body = z
      .object({ password: z.string().min(12).max(1024), backup: z.unknown() })
      .parse(req.body);
    try {
      vault.restore(
        body.backup as Parameters<Vault["restore"]>[0],
        body.password,
      );
      runner.recover();
      return establish(reply);
    } catch (e) {
      failures++;
      lastFailure = Date.now();
      throw e;
    }
  });
  app.post("/api/vault/lock", async (req, reply) => {
    if (runner.active) {
      const t = vault.get<Task>("task", runner.active.id)!;
      t.error = "Execution stopped because the vault was locked.";
      runner.save(t, "cancelled", t.error, "cancelled");
      runner.stop("locked");
    }
    sessions.clear();
    vault.lock();
    reply.clearCookie("psa_session", { path: "/" });
    return { locked: true };
  });
  app.post("/api/vault/backup", async (req, reply) => {
    if (runner.active)
      throw new Error(
        "Wait for the current task to finish before creating a backup.",
      );
    const { password } = passwordSchema.parse(req.body);
    reply.header(
      "content-disposition",
      'attachment; filename="psa-backup.json"',
    );
    return vault.export(password);
  });
  app.get("/api/identity", async () => publicIdentity());
  app.get("/api/models", async () =>
    vault
      .list<ModelConfig>("model")
      .map(({ apiKey, ...m }) => ({ ...m, hasKey: !!apiKey })),
  );
  app.post("/api/models", async (req) => {
    const b = modelSchema.parse(req.body),
      old = b.id ? vault.get<ModelConfig>("model", b.id) : undefined;
    if (b.outputTokens > b.contextTokens / 2)
      throw new Error(
        "Keep the output limit at or below half of the context budget.",
      );
    const m: ModelConfig = {
      ...b,
      id: old?.id || randomUUID(),
      baseUrl: validateEndpoint(b.baseUrl),
      apiKey: b.apiKey ?? old?.apiKey ?? "",
      createdAt: old?.createdAt || new Date().toISOString(),
    };
    vault.put("model", m.id, m);
    const { apiKey, ...safe } = m;
    return { ...safe, hasKey: !!apiKey };
  });
  app.post<{ Params: { id: string } }>("/api/models/:id/test", async (req) => {
    const m = vault.get<ModelConfig>("model", req.params.id);
    if (!m) throw new Error("Model configuration not found.");
    const test = await (options.modelCall || complete)(
      { ...m, outputTokens: 128 },
      'Return ONLY JSON {"status":"PSA_CONNECTED"}. Do not add any other text.',
      "Connection and structured-output capability test.",
      AbortSignal.timeout(300000),
    );
    parseJson(test, z.object({ status: z.literal("PSA_CONNECTED") }));
    return {
      ok: true,
      message: "Chat and structured JSON output are available.",
    };
  });
  app.get("/api/sources", async () =>
    vault
      .list<Source>("source")
      .filter((s) => s.type === "file")
      .map(({ text, ...s }) => ({ ...s, characters: text.length })),
  );
  app.post("/api/sources", async (req) => {
    const file = await req.file();
    if (!file) throw new Error("Choose a file to upload.");
    const bytes = await file.toBuffer();
    const name = file.filename.replace(/[\x00-\x1f]/g, "").slice(0, 180);
    const result = await extractDocument(name, bytes);
    const s: Source = {
      id: randomUUID(),
      name,
      type: "file",
      ...result,
      hash: hash(result.text),
      createdAt: new Date().toISOString(),
    };
    if (!vault.unlocked || !session(req))
      throw new Error(
        "The vault was locked while this document was being read.",
      );
    vault.put("source", s.id, s);
    const { text, ...safe } = s;
    return { ...safe, characters: text.length };
  });
  app.delete<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    if (runner.active)
      throw new Error(
        "Wait for the current task to finish before removing sources.",
      );
    vault.remove("source", req.params.id);
    return { removed: true };
  });
  app.get("/api/memories", async () => vault.list<MemoryEntry>("memory"));
  app.patch<{ Params: { id: string } }>("/api/memories/:id", async (req) => {
    const b = z
      .object({
        value: z.string().min(5).max(800).optional(),
        deleted: z.boolean().optional(),
        restoreVersion: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    const m = vault.get<MemoryEntry>("memory", req.params.id);
    if (!m) throw new Error("Memory not found.");
    let reason = "Edited by you";
    if (b.restoreVersion !== undefined) {
      const v = m.versions[b.restoreVersion];
      if (!v) throw new Error("Memory version not found.");
      m.value = v.value;
      reason = "Restored an earlier version";
    }
    if (b.value) m.value = b.value;
    if (b.deleted !== undefined) {
      m.deleted = b.deleted;
      reason = b.deleted ? "Deleted by you" : "Restored by you";
    }
    m.updatedAt = new Date().toISOString();
    m.versions.push({
      value: m.value,
      at: m.updatedAt,
      sourceTaskId: m.sourceTaskId,
      reason,
    });
    vault.put("memory", m.id, m);
    return m;
  });
  app.get("/api/tasks", async () => vault.list<Task>("task"));
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
    const t = vault.get<Task>("task", req.params.id);
    if (!t) throw new Error("Task not found.");
    return {
      task: t,
      grant: vault.get<AuthorityGrant>("grant", t.grantId),
      artifact: t.artifactId
        ? vault.get<Artifact>("artifact", t.artifactId)
        : undefined,
    };
  });
  app.post("/api/tasks", async (req) => {
    const b = taskSchema.parse(req.body);
    const duplicate = vault
      .list<Task>("task")
      .find((t) => t.idempotencyKey === b.idempotencyKey);
    if (duplicate) return duplicate;
    if (runner.active)
      throw new Error("Another task is running. Wait or cancel it first.");
    const model = vault.get<ModelConfig>("model", b.modelId);
    if (!model) throw new Error("Configure and select a model first.");
    for (const id of b.sourceIds)
      if (vault.get<Source>("source", id)?.type !== "file")
        throw new Error("An attached source is unavailable.");
    for (const value of b.urls) {
      const u = new URL(value);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Use public HTTP or HTTPS links without credentials.");
    }
    const now = new Date().toISOString(),
      id = randomUUID(),
      ident = vault.identity();
    const grant = signGrant(
      {
        id: randomUUID(),
        taskId: id,
        ownerId: ident.ownerId,
        sourceIds: [...new Set(b.sourceIds)],
        urls: [...new Set(b.urls)],
        modelId: model.id,
        modelFingerprint: modelFingerprint(model),
        modelSnapshot: {
          kind: model.kind || "openai",
          baseUrl: model.baseUrl,
          model: model.model,
        },
        outputFormats: ["md", "docx"],
        expiresAt: new Date(
          Date.now() + b.expiresMinutes * 60000,
        ).toISOString(),
        maxCalls: b.maxCalls,
        createdAt: now,
      },
      ident.ownerPrivateKey,
    );
    const t: Task = {
      id,
      idempotencyKey: b.idempotencyKey,
      intent: b.intent,
      language: b.language,
      modelId: b.modelId,
      sourceIds: grant.sourceIds,
      urls: grant.urls,
      grantId: grant.id,
      state: "queued",
      plan: [],
      events: [],
      calls: 0,
      createdAt: now,
      updatedAt: now,
      memoryIds: [],
      attempts: 0,
    };
    vault.transaction(() => {
      vault.put("grant", grant.id, grant);
      vault.put("task", t.id, t);
    });
    runner.start(t.id);
    return t;
  });
  app.post<{ Params: { id: string } }>("/api/tasks/:id/cancel", async (req) => {
    const t = vault.get<Task>("task", req.params.id);
    if (!t) throw new Error("Task not found.");
    if (runner.active?.id === t.id) {
      runner.stop();
      return { cancelled: true };
    }
    if (t.state === "completed")
      throw new Error("A completed task cannot be cancelled.");
    runner.save(t, "cancelled", "Task cancelled.", "cancelled");
    return { cancelled: true };
  });
  app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", async (req) => {
    const t = vault.get<Task>("task", req.params.id);
    if (!t) throw new Error("Task not found.");
    if (!["failed", "cancelled", "interrupted"].includes(t.state))
      throw new Error(
        "Only failed, cancelled or interrupted tasks can be retried.",
      );
    if (runner.active) throw new Error("Another task is running.");
    t.state = "queued";
    vault.put("task", t.id, t);
    runner.start(t.id);
    return t;
  });
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/authorize",
    async (req) => {
      const b = renewalSchema.parse(req.body),
        t = vault.get<Task>("task", req.params.id);
      if (!t) throw new Error("Task not found.");
      if (runner.active)
        throw new Error("Wait until the current execution stops.");
      if (
        !["needs_authorization", "failed", "interrupted", "cancelled"].includes(
          t.state,
        )
      )
        throw new Error("This task does not need new authorization.");
      const sourceIds = [...new Set(b.sourceIds ?? t.sourceIds)],
        urls = [...new Set(b.urls ?? t.urls)];
      for (const id of sourceIds)
        if (vault.get<Source>("source", id)?.type !== "file")
          throw new Error("An attached source is unavailable.");
      for (const value of urls) {
        const u = new URL(value);
        if (
          !["https:", "http:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw new Error(
            "Use public HTTP or HTTPS links without credentials.",
          );
      }
      const ident = vault.identity(),
        model = vault.get<ModelConfig>("model", b.modelId ?? t.modelId);
      if (!model) throw new Error("The selected model was removed.");
      const g = signGrant(
        {
          id: randomUUID(),
          taskId: t.id,
          ownerId: ident.ownerId,
          sourceIds,
          urls,
          modelId: model.id,
          modelFingerprint: modelFingerprint(model),
          modelSnapshot: {
            kind: model.kind || "openai",
            baseUrl: model.baseUrl,
            model: model.model,
          },
          outputFormats: ["md", "docx"],
          expiresAt: new Date(
            Date.now() + b.expiresMinutes * 60000,
          ).toISOString(),
          maxCalls: b.maxCalls,
          createdAt: new Date().toISOString(),
        },
        ident.ownerPrivateKey,
      );
      const old = vault.get<AuthorityGrant>("grant", t.grantId);
      if (old && !old.revokedAt) {
        old.revokedAt = new Date().toISOString();
        old.revocationSignature = signature(
          { grantId: old.id, revokedAt: old.revokedAt },
          ident.ownerPrivateKey,
        );
        vault.put("grant", old.id, old);
      }
      t.grantId = g.id;
      t.sourceIds = sourceIds;
      t.urls = urls;
      t.modelId = model.id;
      t.requestedScope = undefined;
      t.calls = 0;
      t.state = "queued";
      vault.transaction(() => {
        vault.put("grant", g.id, g);
        vault.put("task", t.id, t);
      });
      runner.start(t.id);
      return t;
    },
  );
  app.get("/api/grants", async () => vault.list<AuthorityGrant>("grant"));
  app.post<{ Params: { id: string } }>(
    "/api/grants/:id/revoke",
    async (req) => {
      const g = vault.get<AuthorityGrant>("grant", req.params.id);
      if (!g) throw new Error("Authorization not found.");
      if (!g.revokedAt) {
        g.revokedAt = new Date().toISOString();
        g.revocationSignature = signature(
          { grantId: g.id, revokedAt: g.revokedAt },
          vault.identity().ownerPrivateKey,
        );
        vault.put("grant", g.id, g);
      }
      if (runner.active?.id === g.taskId) runner.stop("revoked");
      return g;
    },
  );
  app.get<{ Params: { id: string; format: string } }>(
    "/api/artifacts/:id/download/:format",
    async (req, reply) => {
      const a = vault.get<Artifact>("artifact", req.params.id);
      if (!a) throw new Error("Document not found.");
      const format = z.enum(["md", "docx"]).parse(req.params.format);
      reply.header(
        "content-disposition",
        `attachment; filename="psa-report-${a.taskId.slice(0, 8)}.${format}"`,
      );
      return format === "md"
        ? reply.type("text/markdown; charset=utf-8").send(a.markdown)
        : reply
            .type(
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            .send(Buffer.from(a.docxBase64, "base64"));
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/artifacts/:id/proof",
    async (req, reply) => {
      const a = vault.get<Artifact>("artifact", req.params.id);
      if (!a) throw new Error("Document not found.");
      const pkg: VerificationPackage = {
        version: 1,
        identity: publicIdentity(),
        grant: vault.get<AuthorityGrant>("grant", a.receipt.grantId)!,
        receipt: a.receipt,
        markdown: a.markdown,
        docxBase64: a.docxBase64,
      };
      reply.header(
        "content-disposition",
        'attachment; filename="psa-verification.json"',
      );
      return pkg;
    },
  );
  app.post("/api/verify", async (req) =>
    verifyPackage(req.body as VerificationPackage),
  );
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    const send = () => {
      if (!session(req) || !vault.unlocked) {
        reply.raw.end();
        return;
      }
      reply.raw.write("event: change\ndata: {}\n\n");
    };
    const heartbeat = setInterval(send, 15000);
    runner.listeners.add(send);
    send();
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      runner.listeners.delete(send);
    });
  });
  if (options.serveWeb && existsSync(resolve("dist/web/index.html"))) {
    await app.register(staticFiles, { root: resolve("dist/web") });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "Endpoint not found." })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    runner.stop("locked");
    if (runner.active) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!runner.active) {
            clearInterval(check);
            resolve();
          }
        }, 20);
      });
    }
    vault.close();
  });
  return { app, vault, runner };
}
