# Ownership and trust model

## What this version establishes

The owner and agent have separate Ed25519 key pairs. Their IDs are SHA-256 fingerprints of their exported public keys. Changing a model leaves those identities unchanged. The local application signs owner authorizations only in response to authenticated user actions; its task runner uses the agent key to attest completed document results.

A random 256-bit vault data key encrypts private record payloads with AES-256-GCM and unique random nonces. Record kind and ID are authenticated as associated data. scrypt derives a passphrase key with N=32768, r=8 and p=1 to wrap the data key. Private content and credentials are not stored in browser local storage or written to request logs. SQLite stores record types and IDs outside encryption; these metadata are not confidential.

The server accepts loopback access only, checks Host and browser Origin, and requires an HTTP-only SameSite Strict session cookie plus a per-session CSRF token for protected writes. The browser and API are served from the same local origin in production. The vault starts locked after a service restart. Five failed unlocks cause a 30-second cooldown.

## Authority and execution

Each immutable signed grant names a task, exact uploaded source IDs, exact input URLs, model endpoint and model name, output formats, expiration and maximum operation count. Renewing creates a new signed grant; revocation has a separately signed record. Tool boundaries are checked before work and after asynchronous model or web requests. Revocation, cancellation and vault locking abort in-flight requests and prevent later document publication.

A model returns a validated plan and report. It does not receive tools for arbitrary code execution, shell access, wallet operations, payments or publication. Unknown plan requirements pause execution rather than authorizing themselves. Model text and third-party content cannot mutate permissions. A research URL is resolved and checked for public addresses, pinned to the checked DNS result, and revalidated at every redirect. Local model endpoints are a separate, user-configured connection and are not available as research links.

Memory extraction operates only on user-entered task text. Saved evidence must be an exact substring of that text; secret-like strings are rejected. Memory is context, never a permission source. Removing memory excludes it from subsequent context selection. Entries are re-read before writing; a deletion prevents their inclusion in the next model call. Context already sent to an in-flight provider cannot be recalled. Stop the task before rerunning with revised memory.

## Limits of the guarantee

This application is a locally trusted process. When unlocked, the process holds decryption capabilities and both identity keys. The separate keys identify their roles; they do not provide hardware separation or protection from malicious software running as the operating-system user. Signing proves integrity and recorded authorization, not the factual truth of a report, independent observation of an external event, or blockchain ownership.

The portable package verifier validates document hashes, key fingerprints, authorization, result signatures and the included revocation record. It cannot discover a later revocation omitted from an old exported package, prove completeness of local history, or provide a trusted external timestamp. Blockchain or independent witnesses are outside v0.1.

Cloud inference sends selected context to the chosen provider. Its retention policies are outside the vault's encryption boundary. Users explicitly select and authorize that service. Research pages are read without cookies or browser login state. Uploaded files are retained as extracted, encrypted text, not as their original binary archives. DOCX and PDF parsing is restricted to text extraction; scanned PDFs need an external OCR step.

A backup contains all private data and credentials in encrypted form. A verification package contains document content in readable form. Generated downloads are ordinary unencrypted files under the user's control. Forgetting the vault or backup passphrase loses access unless another recoverable copy exists.

## Storage changes and rollback

The initial SQLite schema is version 1. Future migrations must inspect `user_version`, take a backup, and preserve encrypted records. Stop the application before changing versions or moving its data directory. The first release has no earlier application schema to migrate.

Public Git history must never contain vault files, passphrases, provider credentials or personal task results. Test and real-model acceptance runs use isolated ignored directories. Production data is never reset as part of testing.
