# v0.1 acceptance report

Checked locally on **4 October 2026**, with Node.js **24.19.0** on macOS. Deterministic model substitutes and actual model inference are reported separately. Private vaults, reports, verification packages and screenshots from these checks stay outside public Git history.

## Deterministic checks

| Check | Result | Coverage |
| --- | --- | --- |
| Type checking | Passed | Frontend, local server and shared records. |
| Production build | Passed | React/Vite assets and compiled Fastify server. |
| Core tests | 25 passed | Encryption, signing, restoration, API controls, execution, documents and memory. |
| Browser acceptance | Passed | Isolated local server and headless Chromium with a deterministic model substitute. |
| DOCX inspection | Passed | Rendered and visually inspected the synthetic browser export and an actual Qwen report. |

Core tests cover incorrect backup passwords and altered ciphertext, identity continuity, grant expiry and revocation, changed model scope, unauthorized sources, operation limits, public redirects into private networks, instruction-like source text, unsupported/scanned PDFs, connection failures, invalid structured output, fabricated source IDs, duplicate requests, cancellation, vault locking, interrupted-work recovery, deleted-memory exclusion (including deletion during planning), version restoration, Chinese memory retrieval, portable verification and modified Markdown/DOCX detection.

Browser acceptance covers creating a vault; saving and testing a model; uploading/selecting a source; authorizing a task; inspecting the plan and cited result; downloading Word and verification files; editing, deleting and restoring memory; checking a signature; exporting a backup; renewing an exhausted grant; locking/unlocking; restoring into a separate empty vault with the same identity and memory; and narrow-screen layout. No browser runtime errors were observed. Desktop and 390-pixel-wide layouts were inspected. The browser's model is a test substitute, so this check does not establish inference quality.

Run these checks with:

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

The GitHub workflow runs type checking, core tests and the build on Node 24. Its remote status is reported by GitHub Actions separately from local acceptance.

## Actual local-model acceptance

The installed **Ollama `qwen2.5:7b`** completed two real source-based research tasks using a PSA white-paper excerpt. The final checks established that:

- A connection test returned valid structured JSON.
- The first task generated a source-referenced Markdown/Word report and saved an explicit user preference from the synthetic goal.
- After closing and reopening the service, the Agent ID and completed document remained available.
- A second task selected the saved preference as relevant context and completed another signed document.
- Restoring an encrypted backup preserved owner/agent IDs, both key pairs and saved memory.
- Both results passed the current package verifier; changing the report caused verification to fail.

This computer used CPU inference. The working settings were a 4096-token context budget and 1024-token output limit. Evidence was shortened to fit that budget, and the report disclosed the shortened evidence. This validates the workflow on brief supplied material; it is not a benchmark for long documents or a claim that model conclusions are correct.

Initial live checks exposed a timeout with a large prompt, invalid memory output, and an Ollama grammar limit when numeric string bounds were sent directly in a JSON schema. The implementation now uses a bounded context, explicit memory categories and a compact structural grammar for Ollama, while enforcing the complete schema limits on the server. These fixes were exercised before the successful live tasks.

A reproducible opt-in run is available:

```sh
npm run test:real
```

It requires a running local Ollama instance with `qwen2.5:7b`, takes several minutes on a CPU, and writes isolated private evidence under ignored `work/real-qa-*/`. `PSA_TEST_MODEL` and `PSA_TEST_BASE_URL` can select another Ollama connection. The deterministic suites do not make inference calls.

## Remaining scope

A cloud OpenAI-compatible service was not tested with paid credentials; its request/response adapter was exercised with substitutes. Public webpage address checks, redirect rejection and extraction were tested, but arbitrary websites, login pages and JavaScript-only pages are not guaranteed to work. Scanned PDFs remain unsupported.

This is a single-user local research release. It provides local cryptographic integrity and an inspectable permission boundary. It does not implement blockchain witnesses, wallets, payments, an agent marketplace, automatic web search, multi-user accounts or independent verification of model conclusions.
