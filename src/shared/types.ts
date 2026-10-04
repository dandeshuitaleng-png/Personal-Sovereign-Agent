export type TaskState =
  | "queued"
  | "planning"
  | "running"
  | "needs_authorization"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface AgentIdentity {
  ownerId: string;
  agentId: string;
  ownerPublicKey: string;
  agentPublicKey: string;
  createdAt: string;
}
export interface SecretIdentity extends AgentIdentity {
  ownerPrivateKey: string;
  agentPrivateKey: string;
}
export interface ModelConfig {
  kind: "openai" | "ollama";
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  contextTokens: number;
  outputTokens: number;
  createdAt: string;
}
export interface Source {
  id: string;
  name: string;
  type: "file" | "url";
  format: string;
  url?: string;
  text: string;
  hash: string;
  createdAt: string;
}
export interface MemoryVersion {
  value: string;
  at: string;
  sourceTaskId: string;
  reason: string;
}
export interface MemoryEntry {
  id: string;
  category: "preference" | "goal" | "project";
  value: string;
  sourceTaskId: string;
  createdAt: string;
  updatedAt: string;
  versions: MemoryVersion[];
  deleted: boolean;
}
export interface AuthorityGrant {
  id: string;
  taskId: string;
  ownerId: string;
  sourceIds: string[];
  urls: string[];
  modelId: string;
  modelFingerprint: string;
  modelSnapshot?: { kind: "openai" | "ollama"; baseUrl: string; model: string };
  outputFormats: ("md" | "docx")[];
  expiresAt: string;
  maxCalls: number;
  createdAt: string;
  signature: string;
  revokedAt?: string;
  revocationSignature?: string;
}
export interface TaskEvent {
  at: string;
  step: string;
  message: string;
}
export interface Task {
  id: string;
  idempotencyKey: string;
  intent: string;
  language: "English" | "Chinese";
  modelId: string;
  sourceIds: string[];
  urls: string[];
  grantId: string;
  state: TaskState;
  plan: string[];
  events: TaskEvent[];
  calls: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  artifactId?: string;
  memoryIds: string[];
  attempts: number;
  requestedScope?: { sourceIds: string[]; urls: string[] };
}
export interface Artifact {
  id: string;
  taskId: string;
  title: string;
  markdown: string;
  docxBase64: string;
  sourceRefs: { id: string; name: string; url?: string; hash: string }[];
  createdAt: string;
  receipt: ActionReceipt;
}
export interface ActionReceipt {
  version: 1;
  taskId: string;
  agentId: string;
  grantId: string;
  grantHash: string;
  intentHash: string;
  markdownHash: string;
  docxHash: string;
  sourceHashes: { id: string; hash: string }[];
  completedAt: string;
  signature: string;
}
export interface VerificationPackage {
  version: 1;
  identity: AgentIdentity;
  grant: AuthorityGrant;
  receipt: ActionReceipt;
  markdown: string;
  docxBase64: string;
}
export interface Report {
  title: string;
  sections: { heading: string; paragraphs: string[]; sourceIds: string[] }[];
  limitations: string[];
}
