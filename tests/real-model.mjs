import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../dist/server/server/app.js";
import { hash } from "../dist/server/server/crypto.js";

// This is an opt-in live acceptance run, separate from deterministic core/browser tests.
mkdirSync("work", { recursive: true });
const output = mkdtempSync(resolve("work/real-qa-"));
const dataDir = join(output, "vault");
const password = randomBytes(24).toString("base64");
let ctx = await createApp({ dataDir });
let restored;
let headers = {};
const request = (method, url, payload) =>
  ctx.app.inject({ method, url, headers, payload });
async function authenticate(route) {
  const response = await ctx.app.inject({
    method: "POST",
    url: route,
    payload: { password },
  });
  assert.equal(response.statusCode, 200, response.body);
  headers = {
    cookie: response.headers["set-cookie"].toString().split(";")[0],
    "x-psa-csrf": response.json().csrf,
  };
}
try {
  await authenticate("/api/vault/setup");
  const configured = await request("POST", "/api/models", {
    kind: "ollama",
    name: "Live acceptance model",
    baseUrl: process.env.PSA_TEST_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.PSA_TEST_MODEL || "qwen2.5:7b",
    contextTokens: 4096,
    outputTokens: 1024,
  });
  assert.equal(configured.statusCode, 200, configured.body);
  const model = configured.json();
  const connection = await request("POST", "/api/models/" + model.id + "/test");
  assert.equal(connection.statusCode, 200, connection.body);
  console.log("Live connection and JSON capability check passed.");
  const text = readFileSync("README.md", "utf8").slice(0, 2400);
  ctx.vault.put("source", "whitepaper", {
    id: "whitepaper",
    name: "PSA white paper v1.2 excerpt",
    type: "file",
    format: "md",
    text,
    hash: hash(text),
    createdAt: new Date().toISOString(),
  });
  async function run(intent, key) {
    const response = await request("POST", "/api/tasks", {
      idempotencyKey: key,
      intent,
      language: "English",
      modelId: model.id,
      sourceIds: ["whitepaper"],
      urls: [],
      expiresMinutes: 60,
      maxCalls: 30,
    });
    assert.equal(response.statusCode, 200, response.body);
    const task = response.json();
    let last = "";
    for (let i = 0; i < 1200; i++) {
      const result = (await request("GET", "/api/tasks/" + task.id)).json();
      const message = result.task.events.at(-1)?.message;
      if (last !== message) {
        console.log(result.task.state + ": " + message);
        last = message;
      }
      if (!["queued", "planning", "running"].includes(result.task.state)) {
        assert.equal(result.task.state, "completed", result.task.error);
        return result;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Live task exceeded the acceptance-run time limit.");
  }
  const first = await run(
    "Using the supplied Personal Sovereign Agent white paper, write a 150-word research brief about model independence, memory continuity and bounded authority. Use the supplied source ID for citations. I prefer concise research reports.",
    "live-first-task",
  );
  writeFileSync(
    join(output, "report.docx"),
    Buffer.from(first.artifact.docxBase64, "base64"),
  );
  writeFileSync(join(output, "report.md"), first.artifact.markdown);
  const proof = (
    await request("GET", "/api/artifacts/" + first.artifact.id + "/proof")
  ).json();
  assert.equal(
    (await request("POST", "/api/verify", proof)).json().valid,
    true,
  );
  writeFileSync(join(output, "proof.json"), JSON.stringify(proof));
  const identity = ctx.vault.identity();
  const memories = (await request("GET", "/api/memories")).json();
  assert(
    memories.some((m) => m.value === "I prefer concise research reports."),
  );
  const backup = (
    await request("POST", "/api/vault/backup", { password })
  ).json();
  await ctx.app.close();
  ctx = await createApp({ dataDir });
  await authenticate("/api/vault/unlock");
  assert.deepEqual(ctx.vault.identity(), identity);
  assert.equal(
    (await request("GET", "/api/tasks/" + first.task.id)).json().task.state,
    "completed",
  );
  assert.equal(
    (
      await request(
        "GET",
        "/api/artifacts/" + first.artifact.id + "/download/docx",
      )
    ).statusCode,
    200,
  );
  console.log("Restart retained identity and document.");
  const second = await run(
    "Using the supplied white paper, compare memory continuity and platform ownership in a 150-word research brief. Follow my existing concise research reports preference.",
    "live-second-task",
  );
  assert(
    second.task.events.some((e) => e.message.includes("1 relevant memory")),
  );
  restored = await createApp({ dataDir: join(output, "restored") });
  const recovery = await restored.app.inject({
    method: "POST",
    url: "/api/vault/restore",
    payload: { password, backup },
  });
  assert.equal(recovery.statusCode, 200, recovery.body);
  assert.deepEqual(restored.vault.identity(), identity);
  assert.deepEqual(restored.vault.list("memory"), memories);
  writeFileSync(
    join(output, "acceptance.json"),
    JSON.stringify(
      {
        model: model.model,
        tasks: 2,
        memoryContinuity: true,
        restart: true,
        signature: true,
        migration: true,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Live acceptance passed. Private evidence is in " + output);
} finally {
  await restored?.app.close();
  await ctx.app.close();
}
