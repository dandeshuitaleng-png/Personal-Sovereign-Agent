import { chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../dist/server/server/app.js";
const modelCall = async (_model, system, user, signal) => {
  signal.throwIfAborted();
  if (system.startsWith("Plan")) {
    const p = JSON.parse(user);
    return JSON.stringify({
      steps: [
        "Read the authorized sources",
        "Analyze agent ownership",
        "Create a research document",
      ],
      requiredSourceIds: p.sources.map((s) => s.id),
      requiredUrls: p.urls,
    });
  }
  if (system.startsWith("Write")) {
    const p = JSON.parse(user);
    return JSON.stringify({
      title: "A research brief on personal agents",
      sections: [
        {
          heading: "Findings",
          paragraphs: [
            "Personal agents need persistent identity and bounded authority.",
          ],
          sourceIds: p.evidence.map((s) => s.id),
        },
      ],
      limitations: ["This brief uses the selected documents."],
    });
  }
  if (system.startsWith("Extract"))
    return JSON.stringify({
      memories: user.includes("I prefer concise reports.")
        ? [{ category: "preference", evidence: "I prefer concise reports." }]
        : [],
    });
  return '{"status":"PSA_CONNECTED"}';
};
const dir = mkdtempSync(join(tmpdir(), "psa-browser-"));
const restoreDir = mkdtempSync(join(tmpdir(), "psa-restore-browser-"));
let { app } = await createApp({ dataDir: dir, modelCall, serveWeb: true });
await app.listen({ host: "127.0.0.1", port: 4318 });
const candidate =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.PSA_BROWSER_EXECUTABLE ||
  (existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : existsSync(candidate)
      ? candidate
      : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
mkdirSync("work/browser-qa", { recursive: true });
const clickNav = async (name) =>
  page
    .locator("nav")
    .getByRole("button", { name: new RegExp("^" + name) })
    .click();
try {
  await page.goto("http://127.0.0.1:4318");
  await page
    .getByRole("heading", { name: "Create your private vault" })
    .waitFor();
  await page.screenshot({
    path: "work/browser-qa/onboarding.png",
    fullPage: true,
  });
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("browser check passphrase");
  await page.getByRole("button", { name: "Create vault", exact: true }).click();
  await page
    .getByRole("heading", { name: "Give your intent a place to act." })
    .waitFor();
  const originalIdentity = await (
    await page.request.get("http://127.0.0.1:4318/api/identity")
  ).json();
  await clickNav("Memory");
  await page.screenshot({
    path: "work/browser-qa/empty-memory.png",
    fullPage: true,
  });
  await clickNav("Settings");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Connection test passed" })
    .waitFor();
  await page.screenshot({
    path: "work/browser-qa/settings.png",
    fullPage: true,
  });
  await clickNav("Workspace");
  await page
    .locator('input[type=file][accept=".txt,.md,.docx,.pdf"]')
    .setInputFiles({
      name: "ownership-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "An agent maintains its own identity, remembers personal context and acts only with delegated authority.",
      ),
    });
  await page.getByRole("checkbox").check();
  await page
    .getByLabel("Your goal", { exact: true })
    .fill(
      "Research the ownership principles in my source. I prefer concise reports.",
    );
  await page.screenshot({
    path: "work/browser-qa/workspace.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Authorize & start", exact: true })
    .click();
  await page
    .getByText("SIGNED DOCUMENT", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(
    await page.getByText("[1] ownership-notes.txt", { exact: true }).count(),
    1,
  );
  await page.getByText("Authorized scope", {exact: true}).click();
  assert((await page.locator(".scope-details").innerText()).includes("http://127.0.0.1:11434"));
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Verification package", exact: true })
    .click();
  const proof = await downloading;
  await proof.saveAs("work/browser-qa/proof.json");
  const docDownloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Word document", exact: true })
    .click();
  const doc = await docDownloading;
  await doc.saveAs("work/browser-qa/report.docx");
  await page.screenshot({ path: "work/browser-qa/result.png", fullPage: true });
  await clickNav("Memory");
  await page
    .getByText("I prefer concise reports.", { exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Edit memory", exact: true }).click();
  await page
    .locator(".memory-card textarea")
    .fill("I prefer short evidence-based reports.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete memory", exact: true })
    .click();
  await page.getByText("PREFERENCE · DELETED", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Restore memory", exact: true })
    .click();
  await page.getByText("PREFERENCE", { exact: true }).waitFor();
  await page.screenshot({ path: "work/browser-qa/memory.png", fullPage: true });
  await clickNav("Authority");
  await page.screenshot({
    path: "work/browser-qa/authority.png",
    fullPage: true,
  });
  await clickNav("Identity");
  await page
    .locator(".proof-card input[type=file]")
    .setInputFiles("work/browser-qa/proof.json");
  await page
    .getByRole("heading", { name: "Verification passed", exact: true })
    .waitFor();
  await page
    .getByLabel("Backup passphrase", { exact: true })
    .fill("portable browser backup passphrase");
  const backupDownloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export encrypted backup", exact: true })
    .click();
  const backup = await backupDownloading;
  await backup.saveAs("work/browser-qa/backup.json");
  await page.screenshot({
    path: "work/browser-qa/identity.png",
    fullPage: true,
  });
  await clickNav("Workspace");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Your goal", { exact: true })
    .fill("Write a brief research note with the selected source.");
  await page.getByText("Task authorization settings", { exact: true }).click();
  await page.getByLabel("Maximum operations", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Authorize & start", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review & renew", exact: true })
    .waitFor();
  await page.getByLabel("Maximum operations", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Authorize & restart", exact: true })
    .click();
  await page
    .getByText("SIGNED DOCUMENT", { exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Lock workspace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Welcome back", exact: true })
    .waitFor();
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("browser check passphrase");
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await page
    .getByRole("heading", { name: "Give your intent a place to act." })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "work/browser-qa/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.goto("about:blank");
  await app.close();
  ({ app } = await createApp({
    dataDir: restoreDir,
    modelCall,
    serveWeb: true,
  }));
  await app.listen({ host: "127.0.0.1", port: 4318 });
  await context.clearCookies();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("http://127.0.0.1:4318");
  await page
    .locator(".restore-link input[type=file]")
    .setInputFiles("work/browser-qa/backup.json");
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("portable browser backup passphrase");
  await page
    .getByRole("button", { name: "Restore agent", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Give your intent a place to act." })
    .waitFor();
  const restoredIdentity = await (
    await page.request.get("http://127.0.0.1:4318/api/identity")
  ).json();
  assert.deepEqual(restoredIdentity, originalIdentity);
  await clickNav("Memory");
  await page
    .getByText("I prefer short evidence-based reports.", { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser acceptance passed: setup, model settings/test, upload, task, downloads, memory edit/delete/restore, proof verification, backup/restore, renewal, lock/unlock, mobile overflow and runtime errors.",
  );
  writeFileSync(
    "work/browser-qa/acceptance.json",
    JSON.stringify(
      {
        passed: true,
        checks: 16,
        runtimeErrors: errors,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(restoreDir, { recursive: true, force: true });
}
