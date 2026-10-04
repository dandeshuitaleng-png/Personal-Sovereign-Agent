# Run Personal Sovereign Agent

PSA v0.1 is a single-user local application for source-based research and document creation. It includes a portable identity, encrypted storage, explicit task authority, inspectable memory and signed documents. It implements a bounded research workflow, with a fixed set of authorized research operations.

## Requirements

- Node.js 24.19 or later in the 24.x series and npm.
- A local Ollama model or a cloud service supporting OpenAI-compatible chat completions.
- A modern browser. All application pages and controls are in English.

## Start the application

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4318**. The server binds to loopback only. The first launch creates an empty storage directory; it does not create your identity or choose a passphrase for you.

Create your vault with a passphrase of at least 12 characters. Keep that passphrase safe. There is no recovery service or backdoor.

In **Settings**, save and test a model connection. For local Ollama:

- Connection type: **Ollama (local)**
- API base URL: `http://127.0.0.1:11434`
- Model name: the installed model name, for example `qwen2.5:7b`
- API key: leave blank for local Ollama
- Context token budget: 4096
- Output token limit: 1024

Ollama uses its native chat endpoint to apply `num_ctx` and `num_predict`. On a CPU, start with a short goal and one brief source. Larger documents are shortened to fit the configured context, and the report discloses this limitation. Calls time out after five minutes.

For a cloud model, choose **OpenAI compatible** and enter its HTTPS API base URL, model name and key. Saving does not send your documents. The connection test checks chat and valid JSON output using a short test message; authorized tasks send their goals, selected source excerpts and relevant memories to the selected service.

## Complete a task

1. Open **Workspace** and describe the research goal. Choose English or Chinese for the output.
2. Upload TXT, Markdown, DOCX or text-based PDF files, and select the ones to use. Files are limited to 10 MB, PDFs to 150 pages, and extracted text to 400,000 characters.
3. Optionally add up to five exact public webpage URLs. The agent reads those pages only; it does not search the web or follow links inside them. HTML/text pages are limited to 5 MB. Local and private research URLs are rejected, including redirects to internal addresses.
4. Review the selected model service, source scope, expiration and operation limit. **Authorize & start** signs that scope and starts the task. The default is 60 minutes and 30 operations, counting model calls, source reads and document-generation operations.
5. Inspect the plan and execution history. Use **Stop task** or **Revoke authorization** whenever needed.
6. Preview and download the Markdown and Word documents. The Word export uses a formal black-and-white layout with readable headings and source references.
7. Download the verification package to check identity, authorization, signatures and document hashes.

If authorization expires, is revoked, reaches its operation limit, or the plan requests additional sources, the task pauses. Review the requested additions, choose the allowed files, links and model, and use **Authorize & restart**. This creates a new grant and restarts the workflow. It does not silently extend the earlier permission.

Failed or cancelled tasks can be retried while their authorization remains valid. An expired or changed scope needs renewal instead. Unfinished tasks after a service restart become **Interrupted** and require an explicit retry.

## Memory

Personal preferences, ongoing goals and project context can be saved automatically from exact quotes in your task goal. Memory extraction never sees source documents or webpages. Every entry has a source task and version history.

You can edit, delete, restore or revert an entry in **Memory**. Deleted entries are excluded from subsequent model calls; encrypted version history is retained so you can undo deletion. Retrieval is local keyword matching; there is no remote embedding service.

## Backup and migration

In **Identity**, export an encrypted backup with a separate backup passphrase. The backup includes identity private keys, model credentials, memories, sources, tasks and documents. Protect the backup as you would protect the vault.

Restore requires an empty data directory. To use another directory:

```sh
PSA_DATA_DIR=/absolute/path/to/empty-psa-data npm start
```

Open the initial screen, choose **Restore from an encrypted backup**, and enter its backup passphrase. That passphrase becomes the restored vault passphrase. Agent and owner IDs remain unchanged. Restoration never replaces an existing vault.

## Verification without the application

```sh
npm run verify -- /path/to/psa-verification.json
```

The command exits with status 0 for a valid package and 1 for failed verification. A verification package contains the report itself, its signed hashes, the owner's signed authorization, and public verification keys. Share it only when you intend to share the document.

## Development and checks

```sh
npm run dev
npm run typecheck
npm test
npm run build
npm run test:browser
```

Development uses http://127.0.0.1:5173 with a same-origin API proxy. `npm run test:browser` launches an isolated test application on port 4318; stop another instance on that port first. Install a Playwright Chromium browser with `npx playwright install chromium`, or set `PSA_BROWSER_EXECUTABLE` to an installed Chromium/Chrome executable.

For an optional live local-model acceptance run, start Ollama with `qwen2.5:7b` installed and run `npm run test:real`. It makes real model calls, uses isolated synthetic goals and a white-paper excerpt, and retains private evidence under ignored `work/real-qa-*/`. CPU inference can take several minutes. The deterministic test suite never contacts your provider.

Private state is in `.psa-data/` by default. `.psa-data/`, `.env` files, local QA files and dependencies are excluded from Git. Before publishing, verify the staged files contain only source code, documentation and the approved white paper.
