# Local API contract

The API is served at `http://127.0.0.1:4318/api`. Protected endpoints require the `psa_session` HTTP-only cookie. Protected POST, PATCH and DELETE requests also require the `x-psa-csrf` value returned by setup, unlock or status. Origin and Host checks apply before handlers. No CORS access is granted to unrelated sites.

## Endpoint groups

| Group | Endpoints | Behavior |
| --- | --- | --- |
| Session | `GET /status`, `POST /vault/setup`, `POST /vault/unlock`, `POST /vault/lock` | Status and password-protected session lifecycle; setup and unlock accept `{password}`. |
| Identity | `GET /identity` | Stable owner/agent IDs and public keys; no private keys. |
| Models | `GET /models`, `POST /models`, `POST /models/:id/test` | Save an encrypted connection and test chat with structured JSON output; list masks the key. |
| Sources | `GET /sources`, `POST /sources`, `DELETE /sources/:id` | Multipart upload of one text document. List returns metadata, not extracted contents. Removal is blocked during execution. |
| Memory | `GET /memories`, `PATCH /memories/:id` | Edit `{value}`, delete/restore `{deleted}`, or restore a historical `{restoreVersion}` index. Each action appends a version. |
| Tasks | `GET /tasks`, `POST /tasks`, `GET /tasks/:id` | Create a task with an idempotency key; details include plan, history, grant and completed artifact. |
| Execution | `POST /tasks/:id/cancel`, `POST /tasks/:id/retry`, `POST /tasks/:id/authorize` | Abort, retry eligible work, or sign a replacement scope and restart. |
| Authority | `GET /grants`, `POST /grants/:id/revoke` | Inspect grants and immediately revoke subsequent execution. |
| Artifacts | `GET /artifacts/:id/download/md`, `GET /artifacts/:id/download/docx`, `GET /artifacts/:id/proof` | Download source-referenced documents or their portable verification package. |
| Verification | `POST /verify` | Return `{valid, checks}` for a verification package. |
| Backup | `POST /vault/backup`, `POST /vault/restore` | Backup accepts `{password}`; restore accepts `{password, backup}` and requires an empty vault. |
| Events | `GET /events` | Session-authenticated SSE `change` events. Clients reload current state; event messages contain no task text. |

## Connection and task payloads

```json
{
  "name": "Local Qwen",
  "kind": "ollama",
  "baseUrl": "http://127.0.0.1:11434",
  "model": "qwen2.5:7b",
  "apiKey": "",
  "contextTokens": 4096,
  "outputTokens": 1024
}
```

Use `kind: "openai"` with the provider's full API base path for compatible chat completions. Updating a connection includes `id`. Omitting `apiKey` on an update preserves it; explicitly passing an empty string clears it. Output limits cannot exceed half the context budget. Changing connection type, endpoint or model changes the authority fingerprint and requires a new grant for existing work.

```json
{
  "idempotencyKey": "a-unique-request-key",
  "intent": "Compare ownership and persistent memory using these sources.",
  "language": "English",
  "modelId": "saved-model-id",
  "sourceIds": ["uploaded-source-id"],
  "urls": [],
  "expiresMinutes": 60,
  "maxCalls": 30
}
```

Renewal accepts `expiresMinutes` and `maxCalls`, plus optional replacement `sourceIds`, `urls` and `modelId`. It retains the goal and output language. Reusing a task idempotency key returns the original task without executing it again. A new key starts new work.

## Errors and lifecycle

Errors use `{error, message}`. Invalid input returns 400, locked sessions return 401, denied Origin/Host/CSRF return 403, and oversized uploads return 413. Model and source errors appear in persisted task history; JSON structure failures stop execution before committing a document.

States are `queued`, `planning`, `running`, `needs_authorization`, `completed`, `failed`, `cancelled` and `interrupted`. Only one task runs at a time. Startup leaves the vault locked; the first successful unlock marks unfinished persisted work interrupted. No task resumes automatically.

The server owns the fixed source, model and document operations. There is no endpoint for model-selected arbitrary commands or filesystem access.
