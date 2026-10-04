import {
  createHash,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
} from "node:crypto";
export const hash = (input: string | Buffer) =>
  createHash("sha256").update(input).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function derive(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, "base64"), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
export interface Envelope {
  iv: string;
  tag: string;
  data: string;
}
export function encrypt(value: string, key: Buffer, aad: string): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function decrypt(e: Envelope, key: Buffer, aad: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(e.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(e.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}
export const keyId = (pub: string) => "psa:" + hash(pub);
export const signature = (value: unknown, key: string) =>
  sign(null, Buffer.from(canonical(value)), key).toString("base64");
export function checkSignature(value: unknown, sig: string, key: string) {
  try {
    return verify(
      null,
      Buffer.from(canonical(value)),
      key,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}
