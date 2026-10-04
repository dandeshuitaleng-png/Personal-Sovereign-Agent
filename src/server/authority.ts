import type {
  AuthorityGrant,
  ModelConfig,
  VerificationPackage,
} from "../shared/types.js";
import { canonical, checkSignature, hash, keyId, signature } from "./crypto.js";
export class AuthorizationError extends Error {
  code = "AUTHORITY_REQUIRED";
}
export function grantPayload(g: AuthorityGrant) {
  const {
    signature: _,
    revokedAt: __,
    revocationSignature: ___,
    ...payload
  } = g;
  return payload;
}
export function modelFingerprint(m: ModelConfig) {
  return hash(
    canonical({
      id: m.id,
      kind: m.kind || "openai",
      baseUrl: m.baseUrl,
      model: m.model,
    }),
  );
}
export function signGrant(
  g: Omit<AuthorityGrant, "signature">,
  key: string,
): AuthorityGrant {
  return { ...g, signature: signature(g, key) };
}
export function authorize(
  grant: AuthorityGrant,
  ownerPublicKey: string,
  taskId: string,
  calls: number,
  operation: {
    sourceId?: string;
    url?: string;
    model?: ModelConfig;
    format?: "md" | "docx";
  },
) {
  if (
    grant.taskId !== taskId ||
    grant.ownerId !== keyId(ownerPublicKey) ||
    !checkSignature(grantPayload(grant), grant.signature, ownerPublicKey)
  )
    throw new AuthorizationError("The task authorization is invalid.");
  if (grant.revokedAt)
    throw new AuthorizationError(
      "Authorization was revoked. Review and renew the scope to continue.",
    );
  if (Date.parse(grant.expiresAt) <= Date.now())
    throw new AuthorizationError(
      "Authorization expired. Review and renew the scope to continue.",
    );
  if (calls >= grant.maxCalls)
    throw new AuthorizationError(
      "The execution limit was reached. Increase the limit to continue.",
    );
  if (operation.sourceId && !grant.sourceIds.includes(operation.sourceId))
    throw new AuthorizationError(
      "This source is outside the authorized scope.",
    );
  if (operation.url && !grant.urls.includes(operation.url))
    throw new AuthorizationError("This link is outside the authorized scope.");
  if (
    operation.model &&
    (grant.modelId !== operation.model.id ||
      grant.modelFingerprint !== modelFingerprint(operation.model))
  )
    throw new AuthorizationError(
      "The model configuration changed. Review the new model and renew authorization.",
    );
  if (operation.format && !grant.outputFormats.includes(operation.format))
    throw new AuthorizationError(
      "This document format is outside the authorized scope.",
    );
}
export function verifyPackage(pkg: VerificationPackage) {
  try {
    const { signature: sig, ...receipt } = pkg.receipt;
    const id = pkg.identity;
    const checks = {
      identity:
        id.agentId === keyId(id.agentPublicKey) &&
        id.ownerId === keyId(id.ownerPublicKey),
      authorization:
        pkg.grant.ownerId === id.ownerId &&
        checkSignature(
          grantPayload(pkg.grant),
          pkg.grant.signature,
          id.ownerPublicKey,
        ),
      modelScope:
        !pkg.grant.modelSnapshot ||
        pkg.grant.modelFingerprint ===
          hash(
            canonical({ id: pkg.grant.modelId, ...pkg.grant.modelSnapshot }),
          ),
      revocation:
        !pkg.grant.revokedAt ||
        checkSignature(
          { grantId: pkg.grant.id, revokedAt: pkg.grant.revokedAt },
          pkg.grant.revocationSignature || "",
          id.ownerPublicKey,
        ),
      receipt:
        pkg.receipt.agentId === id.agentId &&
        checkSignature(receipt, sig, id.agentPublicKey),
      linkage:
        receipt.taskId === pkg.grant.taskId &&
        receipt.grantId === pkg.grant.id &&
        receipt.grantHash === hash(canonical(grantPayload(pkg.grant))),
      timing:
        Date.parse(receipt.completedAt) <= Date.parse(pkg.grant.expiresAt) &&
        Date.parse(receipt.completedAt) >= Date.parse(pkg.grant.createdAt) &&
        (!pkg.grant.revokedAt ||
          Date.parse(receipt.completedAt) < Date.parse(pkg.grant.revokedAt)),
      markdown: receipt.markdownHash === hash(pkg.markdown),
      docx: receipt.docxHash === hash(Buffer.from(pkg.docxBase64, "base64")),
    };
    return { valid: Object.values(checks).every(Boolean), checks };
  } catch {
    return { valid: false, checks: { package: false } };
  }
}
