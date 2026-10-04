import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  Fingerprint,
  FolderOpen,
  KeyRound,
  Layers,
  LockKeyhole,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  AgentIdentity,
  Artifact,
  AuthorityGrant,
  MemoryEntry,
  ModelConfig,
  Source,
  Task,
} from "../shared/types";
import "./style.css";

type Page = "Workspace" | "Memory" | "Authority" | "Identity" | "Settings";
type SafeModel = Omit<ModelConfig, "apiKey"> & { hasKey: boolean };
type Detail = { task: Task; grant: AuthorityGrant; artifact?: Artifact };
const date = (v: string) => new Date(v).toLocaleString();
function App() {
  const [session, setSession] = useState<{
    initialized: boolean;
    unlocked: boolean;
    csrf?: string;
  }>();
  const [page, setPage] = useState<Page>("Workspace"),
    [tasks, setTasks] = useState<Task[]>([]),
    [models, setModels] = useState<SafeModel[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [memories, setMemories] = useState<MemoryEntry[]>([]),
    [grants, setGrants] = useState<AuthorityGrant[]>([]),
    [identity, setIdentity] = useState<AgentIdentity>();
  const [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<Detail>(),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [password, setPassword] = useState(""),
    [restoreFile, setRestoreFile] = useState<File>(),
    [backupPassword, setBackupPassword] = useState("");
  const [intent, setIntent] = useState(""),
    [urls, setUrls] = useState(""),
    [language, setLanguage] = useState("English"),
    [modelId, setModelId] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [minutes, setMinutes] = useState(60),
    [maxCalls, setMaxCalls] = useState(30);
  const [modelForm, setModelForm] = useState({
    id: "",
    kind: "ollama" as "openai" | "ollama",
    name: "Local Qwen",
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen2.5:7b",
    apiKey: "",
    contextTokens: 4096,
    outputTokens: 1024,
  });
  const [renewSources, setRenewSources] = useState<string[]>([]),
    [renewUrls, setRenewUrls] = useState(""),
    [renewModelId, setRenewModelId] = useState("");
  const [editingMemory, setEditingMemory] = useState<string>(),
    [memoryValue, setMemoryValue] = useState(""),
    [proofResult, setProofResult] = useState<{
      valid: boolean;
      checks: Record<string, boolean>;
    }>();
  const api = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      const isForm = body instanceof FormData;
      const response = await fetch("/api" + path, {
        method,
        credentials: "same-origin",
        headers: {
          ...(!isForm && body ? { "content-type": "application/json" } : {}),
          ...(session?.csrf ? { "x-psa-csrf": session.csrf } : {}),
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
      if (!response.ok) {
        const e = await response.json();
        if (response.status === 401)
          setSession((s) => (s ? { ...s, unlocked: false } : s));
        throw new Error(e.message || "The request could not be completed.");
      }
      return response.json();
    },
    [session?.csrf],
  );
  const load = useCallback(async () => {
    const [t, m, s, mem, g, i] = await Promise.all([
      api<Task[]>("/tasks"),
      api<SafeModel[]>("/models"),
      api<Source[]>("/sources"),
      api<MemoryEntry[]>("/memories"),
      api<AuthorityGrant[]>("/grants"),
      api<AgentIdentity>("/identity"),
    ]);
    setTasks(t);
    setModels(m);
    setSources(s);
    setMemories(mem);
    setGrants(g);
    setIdentity(i);
    setModelId((old) => old || m[0]?.id || "");
    if (selected) setDetail(await api<Detail>("/tasks/" + selected));
  }, [api, selected]);
  useEffect(() => {
    void api<typeof session>("/status")
      .then(setSession)
      .catch((e) => setNotice({ text: e.message, error: true }));
  }, []);
  useEffect(() => {
    if (session?.unlocked) {
      void load().catch((e) => setNotice({ text: e.message, error: true }));
      const events = new EventSource("/api/events");
      events.addEventListener("change", () => void load().catch(() => {}));
      return () => events.close();
    }
  }, [session?.unlocked, load]);
  useEffect(() => {
    if (detail) {
      setRenewSources(detail.task.sourceIds);
      setRenewUrls(detail.task.urls.join("\n"));
      setRenewModelId(detail.task.modelId);
    }
  }, [detail?.task.id]);
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setNotice({
        text: e instanceof Error ? e.message : "The request failed.",
        error: true,
      });
    } finally {
      setBusy("");
    }
  };
  const unlock = () =>
    act("unlock", async () => {
      const state = await api<{ csrf: string; unlocked: boolean }>(
        restoreFile
          ? "/vault/restore"
          : session?.initialized
            ? "/vault/unlock"
            : "/vault/setup",
        "POST",
        restoreFile
          ? { password, backup: JSON.parse(await restoreFile.text()) }
          : { password },
      );
      setSession({ initialized: true, ...state });
      setPassword("");
      setRestoreFile(undefined);
    });
  const running = tasks.find((t) =>
    ["planning", "running", "queued"].includes(t.state),
  );
  const download = async (path: string, name: string, body?: unknown) => {
    const r = await fetch("/api" + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? {
            "content-type": "application/json",
            "x-psa-csrf": session?.csrf || "",
          }
        : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.message);
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const upload = async (file: File) => {
    const f = new FormData();
    f.append("file", file);
    await api("/sources", "POST", f);
    await load();
    setNotice({ text: "Source added. Select it for a task." });
  };
  const startTask = () =>
    act("task", async () => {
      const t = await api<Task>("/tasks", "POST", {
        idempotencyKey: crypto.randomUUID(),
        intent,
        modelId,
        sourceIds: checked,
        urls: urls
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        language,
        expiresMinutes: minutes,
        maxCalls,
      });
      setSelected(t.id);
      setDetail(await api<Detail>("/tasks/" + t.id));
      setIntent("");
      await load();
    });
  const editModel = (m: SafeModel) => {
    setModelForm({
      id: m.id,
      kind: m.kind || "openai",
      name: m.name,
      baseUrl: m.baseUrl,
      model: m.model,
      apiKey: "",
      contextTokens: m.contextTokens,
      outputTokens: m.outputTokens,
    });
  };
  const title: Record<Page, string> = {
    Workspace: "Give your intent a place to act.",
    Memory: "Context that stays with you.",
    Authority: "You set the boundaries.",
    Identity: "One agent. A continuous identity.",
    Settings: "Choose the intelligence.",
  };
  const subtitle: Record<Page, string> = {
    Workspace:
      "Research from your sources. A document you can inspect. A result you can verify.",
    Memory:
      "Personal context saved from your words, with a visible history and an undo path.",
    Authority:
      "Review what each task may read, which model it may use, and when permission ends.",
    Identity:
      "Your identity, history and memory remain yours when the model changes.",
    Settings:
      "Connect a local or cloud model without changing who your agent is.",
  };
  if (!session)
    return (
      <div className="loading">
        <Layers size={32} />
        <p>Opening your workspace…</p>
        {notice && <p role="alert">{notice.text}</p>}
      </div>
    );
  if (!session.unlocked)
    return (
      <main className="onboarding">
        <section className="welcome">
          <div className="brand">
            <span className="brandmark">P</span>
            <span>
              PERSONAL
              <br />
              SOVEREIGN AGENT
            </span>
          </div>
          <div>
            <span className="eyebrow">YOUR PERSONAL WORKSPACE</span>
            <h1>
              An agent that
              <br />
              remains yours.
            </h1>
            <p>
              Keep a continuous identity, remember what matters, and turn your
              intent into work you can verify.
            </p>
            <div className="welcome-trust">
              <Fingerprint /> Persistent identity <span>·</span> <ShieldCheck />{" "}
              Defined authority
            </div>
          </div>
          <small>LOCAL FIRST · INDIVIDUALLY OWNED</small>
        </section>
        <section className="unlock-panel">
          <div className="unlock-box">
            <LockKeyhole size={30} />
            <h2>
              {restoreFile
                ? "Restore your agent"
                : session.initialized
                  ? "Welcome back"
                  : "Create your private vault"}
            </h2>
            <p>
              {restoreFile
                ? "Choose your encrypted backup and enter its passphrase. It becomes the passphrase for this restored vault."
                : session.initialized
                  ? "Unlock your vault to continue with your identity and memory."
                  : "A passphrase protects your identity, sources and memory on this computer. Keep it somewhere safe."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              <label>
                Passphrase
                <input
                  autoFocus
                  type="password"
                  autoComplete={
                    session.initialized ? "current-password" : "new-password"
                  }
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <small>
                At least 12 characters. Your passphrase cannot be recovered.
              </small>
              <button className="primary wide" disabled={!!busy}>
                {busy
                  ? "Opening…"
                  : restoreFile
                    ? "Restore agent"
                    : session.initialized
                      ? "Unlock vault"
                      : "Create vault"}
                <ArrowUpRight size={17} />
              </button>
            </form>
            {!session.initialized && (
              <label className="restore-link">
                <Upload size={16} />
                {restoreFile
                  ? restoreFile.name
                  : "Restore from an encrypted backup"}
                <input
                  type="file"
                  accept=".json"
                  hidden
                  onChange={(e) => setRestoreFile(e.target.files?.[0])}
                />
              </label>
            )}
            {restoreFile && (
              <button
                className="text-button"
                onClick={() => setRestoreFile(undefined)}
              >
                Create a new vault instead
              </button>
            )}
            {notice && (
              <div className="notice error" role="alert">
                {notice.text}
              </div>
            )}
          </div>
        </section>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandmark">P</span>
          <span>
            PERSONAL
            <br />
            SOVEREIGN AGENT
          </span>
        </div>
        <div className="agent-label">
          <span className="dot" /> Your agent{" "}
          <span className="local-tag">LOCAL</span>
        </div>
        <nav aria-label="Main navigation">
          {(
            [
              ["Workspace", Layers],
              ["Memory", FolderOpen],
              ["Authority", ShieldCheck],
              ["Identity", Fingerprint],
              ["Settings", Settings2],
            ] as const
          ).map(([p, Icon]) => (
            <button
              key={p}
              className={page === p ? "nav-item active" : "nav-item"}
              onClick={() => setPage(p)}
            >
              <Icon size={18} />
              {p}
              {p === "Memory" && (
                <span className="nav-count">
                  {memories.filter((m) => !m.deleted).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="recent">
          <div className="eyebrow">RECENT TASKS</div>
          {tasks.slice(0, 5).map((t) => (
            <button
              key={t.id}
              className={"recent-task " + (selected === t.id ? "selected" : "")}
              onClick={() => {
                setPage("Workspace");
                setSelected(t.id);
              }}
            >
              <FileText size={14} />
              <span>{t.intent}</span>
              <span className={"task-dot " + t.state} />
            </button>
          ))}
          {!tasks.length && (
            <p className="quiet">Your first task will appear here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="identity-mini">
            <Fingerprint size={18} />
            <div>
              <strong>Identity connected</strong>
              <small>{identity?.agentId.slice(0, 18)}…</small>
            </div>
          </div>
          <button
            className="lock-button"
            onClick={() =>
              void act("lock", async () => {
                await api("/vault/lock", "POST");
                setSession({ ...session, unlocked: false });
                setDetail(undefined);
                setTasks([]);
                setMemories([]);
              })
            }
          >
            <LockKeyhole size={15} />
            Lock workspace
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Personal workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </span>
          <div>
            <span className="dot" />
            {running ? "Agent working" : "Ready for your intent"}
          </div>
        </header>
        <div className="content">
          <header className="page-heading">
            <div>
              <div className="eyebrow">PERSONAL SOVEREIGN AGENT</div>
              <h1>{title[page]}</h1>
              <p>{subtitle[page]}</p>
            </div>
            {page === "Workspace" && selected && (
              <button
                className="secondary"
                onClick={() => {
                  setSelected(undefined);
                  setDetail(undefined);
                }}
              >
                <Plus size={16} />
                New task
              </button>
            )}
          </header>
          {notice && (
            <div
              role={notice.error ? "alert" : "status"}
              className={"notice " + (notice.error ? "error" : "")}
            >
              <span>{notice.text}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice(undefined)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Workspace" && !selected && (
            <div className="workspace-grid">
              <section className="panel composer">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">NEW TASK</span>
                    <h2>What would you like to understand?</h2>
                  </div>
                  <Layers size={22} />
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void startTask();
                  }}
                >
                  <label>
                    Your goal
                    <textarea
                      placeholder="Compare the approaches in my sources and write a concise research brief. Include limitations and cite the evidence."
                      rows={5}
                      minLength={5}
                      maxLength={12000}
                      required
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                    />
                  </label>
                  <div className="field-pair">
                    <label>
                      Model
                      <select
                        required
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                      >
                        <option value="">Choose a model</option>
                        {models.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.name} · {m.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Document language
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        <option>English</option>
                        <option>Chinese</option>
                      </select>
                    </label>
                  </div>
                  <div className="source-heading">
                    <label>Task sources</label>
                    <label className="upload-button">
                      <Upload size={15} />
                      {busy === "upload" ? "Reading…" : "Add a file"}
                      <input
                        type="file"
                        hidden
                        accept=".txt,.md,.docx,.pdf"
                        disabled={!!busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void act("upload", () => upload(f));
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <div className="source-picker">
                    {sources.map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={checked.includes(s.id)}
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? [...checked, s.id]
                                : checked.filter((id) => id !== s.id),
                            )
                          }
                        />
                        <FileText size={16} />
                        <span>{s.name}</span>
                        <small>{s.format.toUpperCase()}</small>
                      </label>
                    ))}
                    {!sources.length && (
                      <p>
                        Add documents to ground your research.
                        <br />
                        <small>
                          TXT, Markdown, DOCX, or text-based PDF · up to 10 MB
                        </small>
                      </p>
                    )}
                  </div>
                  <label>
                    Public webpage links{" "}
                    <span className="optional">Optional</span>
                    <textarea
                      rows={2}
                      placeholder="One exact URL per line"
                      value={urls}
                      onChange={(e) => setUrls(e.target.value)}
                    />
                  </label>
                  <details className="scope-settings">
                    <summary>
                      <ShieldCheck size={16} />
                      Task authorization settings
                    </summary>
                    <div className="field-pair">
                      <label>
                        Valid for (minutes)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={minutes}
                          onChange={(e) => setMinutes(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Maximum operations
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={maxCalls}
                          onChange={(e) => setMaxCalls(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  </details>
                  <div className="composer-footer">
                    <p>
                      Starting signs permission to use the selected sources and
                      model, and create documents.
                    </p>
                    <button
                      className="primary"
                      disabled={!!busy || !!running || !modelId}
                    >
                      {busy === "task"
                        ? "Starting…"
                        : running
                          ? "Task in progress"
                          : "Authorize & start"}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </form>
              </section>
              <aside className="workspace-aside">
                <section className="panel scope-card">
                  <ShieldCheck size={28} />
                  <h2>Within your authority.</h2>
                  <p>
                    Your agent works inside the scope you define. You can revoke
                    permission or stop a task at any time.
                  </p>
                  <dl>
                    <div>
                      <dt>Sources</dt>
                      <dd>
                        {checked.length} file{checked.length === 1 ? "" : "s"} ·{" "}
                        {urls.split("\n").filter((s) => s.trim()).length} link
                        {urls.split("\n").filter((s) => s.trim()).length === 1
                          ? ""
                          : "s"}
                      </dd>
                    </div>
                    <div>
                      <dt>Output</dt>
                      <dd>Markdown & Word</dd>
                    </div>
                    <div>
                      <dt>Authorization</dt>
                      <dd>
                        {minutes} minutes · {maxCalls} operations
                      </dd>
                    </div>
                    <div>
                      <dt>Model service</dt>
                      <dd>
                        {models.find((m) => m.id === modelId)?.baseUrl ||
                          "Not selected"}
                      </dd>
                    </div>
                  </dl>
                  {modelId && (
                    <p className="small-note">
                      Selected task text, relevant memories and source excerpts
                      will be sent to this model service.
                    </p>
                  )}
                </section>
                <section className="continuity">
                  <Fingerprint size={24} />
                  <h3>Your context carries forward.</h3>
                  <p>
                    Switch models while keeping your identity, task history and
                    memory.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setPage("Identity")}
                  >
                    View your identity
                    <ChevronRight size={15} />
                  </button>
                </section>
                {!models.length && (
                  <div className="notice">
                    <div>
                      Connect a model to begin.
                      <button
                        className="text-button"
                        onClick={() => setPage("Settings")}
                      >
                        Open settings <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
          {page === "Workspace" && selected && detail && (
            <div className="workspace-grid">
              <div>
                <section className="panel task-panel">
                  <div className="panel-title">
                    <span className={"status " + detail.task.state}>
                      {detail.task.state.replaceAll("_", " ")}
                    </span>
                    <span className="muted">{date(detail.task.createdAt)}</span>
                  </div>
                  <h2>{detail.task.intent}</h2>
                  {detail.task.error && (
                    <div className="notice error">{detail.task.error}</div>
                  )}
                  <h3>Execution plan</h3>
                  {detail.task.plan.length ? (
                    <ol className="plan-list">
                      {detail.task.plan.map((s, i) => (
                        <li key={i}>
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {s}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="quiet">The agent is preparing your plan.</p>
                  )}
                  <div className="task-actions">
                    {running?.id === selected && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void act("cancel", async () => {
                            await api("/tasks/" + selected + "/cancel", "POST");
                            await load();
                          })
                        }
                      >
                        <Square size={14} />
                        Stop task
                      </button>
                    )}
                    {["failed", "cancelled", "interrupted"].includes(
                      detail.task.state,
                    ) && (
                      <button
                        className="secondary"
                        disabled={!!busy || !!running}
                        onClick={() =>
                          void act("retry", async () => {
                            await api("/tasks/" + selected + "/retry", "POST");
                            await load();
                          })
                        }
                      >
                        <RotateCcw size={15} />
                        Retry task
                      </button>
                    )}
                  </div>
                  <details className="execution-log" open={!detail.artifact}>
                    <summary>Execution history</summary>
                    {detail.task.events.map((e, i) => (
                      <div key={i}>
                        <span className="log-dot" />
                        <p>
                          {e.message}
                          <small>{date(e.at)}</small>
                        </p>
                      </div>
                    ))}
                  </details>
                </section>
                {detail.artifact && (
                  <section className="panel result-panel">
                    <div className="panel-title">
                      <div>
                        <span className="eyebrow">SIGNED DOCUMENT</span>
                        <h2>{detail.artifact.title}</h2>
                      </div>
                      <Check size={24} />
                    </div>
                    <div className="downloads">
                      {(["md", "docx"] as const).map((f) => (
                        <button
                          className="secondary"
                          key={f}
                          onClick={() =>
                            void act("download", () =>
                              download(
                                "/artifacts/" +
                                  detail.artifact!.id +
                                  "/download/" +
                                  f,
                                "psa-report." + f,
                              ),
                            )
                          }
                        >
                          <Download size={15} />
                          {f === "md" ? "Markdown" : "Word document"}
                        </button>
                      ))}
                      <button
                        className="secondary"
                        onClick={() =>
                          void act("proof", () =>
                            download(
                              "/artifacts/" + detail.artifact!.id + "/proof",
                              "psa-verification.json",
                            ),
                          )
                        }
                      >
                        <ShieldCheck size={15} />
                        Verification package
                      </button>
                    </div>
                    <div className="document-preview">
                      {detail.artifact.markdown
                        .split("\n")
                        .map((l, i) =>
                          l.startsWith("# ") ? (
                            <h2 key={i}>{l.slice(2)}</h2>
                          ) : l.startsWith("## ") ? (
                            <h3 key={i}>{l.slice(3)}</h3>
                          ) : l ? (
                            <p key={i}>{l}</p>
                          ) : null,
                        )}
                    </div>
                  </section>
                )}
              </div>
              <aside>
                <section className="panel scope-card">
                  <ShieldCheck size={26} />
                  <h2>Task authority</h2>
                  <details className="scope-details">
                    <summary>Authorized scope</summary>
                    <p>
                      <strong>Model</strong>
                      <br />
                      {detail.grant?.modelSnapshot?.model ||
                        models.find((m) => m.id === detail.task.modelId)?.model}
                    </p>
                    <p className="scope-url">
                      {detail.grant?.modelSnapshot?.baseUrl ||
                        "See the signed model fingerprint in the verification package."}
                    </p>
                    <p>
                      <strong>Allowed files</strong>
                      <br />
                      {detail.grant?.sourceIds
                        .map(
                          (id) => sources.find((s) => s.id === id)?.name || id,
                        )
                        .join(", ") || "None"}
                    </p>
                    <p className="scope-url">
                      <strong>Allowed links</strong>
                      <br />
                      {detail.grant?.urls.join("\n") || "None"}
                    </p>
                    <p>
                      <strong>Output</strong>
                      <br />
                      Markdown and Word document
                    </p>
                  </details>
                  <dl>
                    <div>
                      <dt>Expires</dt>
                      <dd>{date(detail.grant.expiresAt)}</dd>
                    </div>
                    <div>
                      <dt>Operations</dt>
                      <dd>
                        {detail.task.calls} / {detail.grant.maxCalls}
                      </dd>
                    </div>
                    <div>
                      <dt>Sources</dt>
                      <dd>
                        {detail.task.sourceIds.length} files ·{" "}
                        {detail.task.urls.length} links
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        {detail.grant.revokedAt
                          ? "Revoked"
                          : Date.parse(detail.grant.expiresAt) < Date.now()
                            ? "Expired"
                            : "Signed by you"}
                      </dd>
                    </div>
                  </dl>
                  {!detail.grant.revokedAt &&
                    detail.task.state !== "completed" && (
                      <button
                        className="secondary wide"
                        onClick={() =>
                          void act("revoke", async () => {
                            await api(
                              "/grants/" + detail.grant.id + "/revoke",
                              "POST",
                            );
                            await load();
                          })
                        }
                      >
                        <X size={15} />
                        Revoke authorization
                      </button>
                    )}
                  {[
                    "needs_authorization",
                    "failed",
                    "interrupted",
                    "cancelled",
                  ].includes(detail.task.state) && (
                    <form
                      className="renew"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act("renew", async () => {
                          await api(
                            "/tasks/" + selected + "/authorize",
                            "POST",
                            {
                              expiresMinutes: minutes,
                              maxCalls,
                              sourceIds: renewSources,
                              urls: renewUrls
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                              modelId: renewModelId,
                            },
                          );
                          await load();
                        });
                      }}
                    >
                      <h3>Review & renew</h3>
                      <p>
                        Review the sources, links and model below. Renewing
                        signs a new scope and restarts execution from the
                        beginning.
                      </p>
                      {detail.task.requestedScope &&
                        (detail.task.requestedScope.urls.length > 0 ||
                          detail.task.requestedScope.sourceIds.length > 0) && (
                          <div className="notice error">
                            <span>
                              Requested additions:{" "}
                              {[
                                ...detail.task.requestedScope.urls,
                                ...detail.task.requestedScope.sourceIds,
                              ].join(", ")}
                              . Add only the sources you want to permit.
                            </span>
                          </div>
                        )}
                      <label>
                        Model
                        <select
                          value={renewModelId}
                          onChange={(e) => setRenewModelId(e.target.value)}
                        >
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {m.model}
                            </option>
                          ))}
                        </select>
                        <span className="read-only-value">
                          {models.find((m) => m.id === renewModelId)?.baseUrl}
                        </span>
                      </label>
                      <label>Allowed files</label>
                      <div className="source-picker">
                        {sources.map((s) => (
                          <label key={s.id}>
                            <input
                              type="checkbox"
                              checked={renewSources.includes(s.id)}
                              onChange={(e) =>
                                setRenewSources(
                                  e.target.checked
                                    ? [...renewSources, s.id]
                                    : renewSources.filter((id) => id !== s.id),
                                )
                              }
                            />
                            <span>{s.name}</span>
                          </label>
                        ))}
                      </div>
                      <label>
                        Allowed public links
                        <textarea
                          rows={3}
                          value={renewUrls}
                          onChange={(e) => setRenewUrls(e.target.value)}
                        />
                      </label>
                      <label>
                        Valid for (minutes)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={minutes}
                          onChange={(e) => setMinutes(+e.target.value)}
                        />
                      </label>
                      <label>
                        Maximum operations
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={maxCalls}
                          onChange={(e) => setMaxCalls(+e.target.value)}
                        />
                      </label>
                      <button
                        className="primary wide"
                        disabled={!!busy || !!running}
                      >
                        Authorize & restart
                        <ArrowUpRight size={16} />
                      </button>
                    </form>
                  )}
                </section>
              </aside>
            </div>
          )}
          {page === "Memory" && (
            <>
              <div className="section-row">
                <span>
                  {memories.filter((m) => !m.deleted).length} active memories
                </span>
                <span className="muted">Saved only from your words</span>
              </div>
              {!memories.length && (
                <Empty
                  icon={<FolderOpen />}
                  title="Your context will grow here."
                  text="Mention a lasting preference or project in your task goal. Your agent saves the exact words with their source."
                />
              )}
              <div className="memory-grid">
                {memories.map((m) => (
                  <section
                    className={
                      "panel memory-card " + (m.deleted ? "deleted" : "")
                    }
                    key={m.id}
                  >
                    <div className="section-row">
                      <span className="eyebrow">
                        {m.category.toUpperCase()}
                        {m.deleted ? " · DELETED" : ""}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={
                          m.deleted ? "Restore memory" : "Delete memory"
                        }
                        onClick={() =>
                          void act("memory", async () => {
                            await api("/memories/" + m.id, "PATCH", {
                              deleted: !m.deleted,
                            });
                            await load();
                          })
                        }
                      >
                        {m.deleted ? (
                          <RotateCcw size={16} />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                    {editingMemory === m.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("memory", async () => {
                            await api("/memories/" + m.id, "PATCH", {
                              value: memoryValue,
                            });
                            setEditingMemory(undefined);
                            await load();
                          });
                        }}
                      >
                        <textarea
                          rows={3}
                          required
                          minLength={5}
                          maxLength={800}
                          value={memoryValue}
                          onChange={(e) => setMemoryValue(e.target.value)}
                        />
                        <button className="primary small" disabled={!!busy}>
                          Save changes
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setEditingMemory(undefined)}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <p>{m.value}</p>
                        {!m.deleted && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setEditingMemory(m.id);
                              setMemoryValue(m.value);
                            }}
                          >
                            Edit memory
                            <ChevronRight size={15} />
                          </button>
                        )}
                      </>
                    )}
                    <small>Updated {date(m.updatedAt)}</small>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPage("Workspace");
                        setSelected(m.sourceTaskId);
                      }}
                    >
                      View source task
                      <ArrowUpRight size={14} />
                    </button>
                    <details>
                      <summary>Version history · {m.versions.length}</summary>
                      {m.versions.map((v, i) => (
                        <div className="version" key={i}>
                          <p>{v.value}</p>
                          <small>
                            {v.reason} · {date(v.at)}
                          </small>
                          {i < m.versions.length - 1 && (
                            <button
                              className="text-button"
                              onClick={() =>
                                void act("memory", async () => {
                                  await api("/memories/" + m.id, "PATCH", {
                                    restoreVersion: i,
                                  });
                                  await load();
                                })
                              }
                            >
                              Restore this version
                            </button>
                          )}
                        </div>
                      ))}
                    </details>
                  </section>
                ))}
              </div>
            </>
          )}
          {page === "Authority" && (
            <>
              {!grants.length ? (
                <Empty
                  icon={<ShieldCheck />}
                  title="Authority starts with your intent."
                  text="Each task creates a signed, bounded authorization. Review or revoke it here."
                />
              ) : (
                <div className="panel grant-list">
                  {grants.map((g) => (
                    <div className="grant-row" key={g.id}>
                      <ShieldCheck size={22} />
                      <div>
                        <strong>
                          {tasks.find((t) => t.id === g.taskId)?.intent ||
                            g.taskId}
                        </strong>
                        <small>
                          {g.sourceIds.length} files · {g.urls.length} links ·{" "}
                          {g.maxCalls} operations · expires {date(g.expiresAt)}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => {
                            setPage("Workspace");
                            setSelected(g.taskId);
                          }}
                        >
                          View task
                          <ChevronRight size={14} />
                        </button>
                      </div>
                      <span
                        className={
                          "status " +
                          (g.revokedAt
                            ? "cancelled"
                            : Date.parse(g.expiresAt) < Date.now()
                              ? "interrupted"
                              : "completed")
                        }
                      >
                        {g.revokedAt
                          ? "Revoked"
                          : Date.parse(g.expiresAt) < Date.now()
                            ? "Expired"
                            : "Authorized"}
                      </span>
                      {!g.revokedAt && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void act("revoke", async () => {
                              await api("/grants/" + g.id + "/revoke", "POST");
                              await load();
                            })
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {page === "Identity" && (
            <div className="identity-grid">
              <section className="panel identity-card">
                <Fingerprint size={36} />
                <h2>Your persistent identity</h2>
                <p>
                  This identity stays the same across models and after restoring
                  an encrypted backup.
                </p>
                <label>
                  Agent ID<code>{identity?.agentId}</code>
                </label>
                <label>
                  Owner ID<code>{identity?.ownerId}</code>
                </label>
                <label>
                  Created
                  <span className="read-only-value">
                    {identity && date(identity.createdAt)}
                  </span>
                </label>
                <details>
                  <summary>Public verification keys</summary>
                  <pre>{identity?.agentPublicKey}</pre>
                  <pre>{identity?.ownerPublicKey}</pre>
                </details>
              </section>
              <div>
                <section className="panel backup-card">
                  <Download size={26} />
                  <h2>Take your agent with you.</h2>
                  <p>
                    Export identity keys, memory, task history and model
                    settings in an encrypted backup. Restore it into an empty
                    vault on another installation.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("backup", async () => {
                        await download("/vault/backup", "psa-backup.json", {
                          password: backupPassword,
                        });
                        setBackupPassword("");
                      });
                    }}
                  >
                    <label>
                      Backup passphrase
                      <input
                        type="password"
                        minLength={12}
                        required
                        autoComplete="new-password"
                        value={backupPassword}
                        onChange={(e) => setBackupPassword(e.target.value)}
                      />
                    </label>
                    <button className="primary" disabled={!!busy || !!running}>
                      <Download size={16} />
                      Export encrypted backup
                    </button>
                  </form>
                </section>
                <section className="panel proof-card">
                  <ShieldCheck size={26} />
                  <h2>Verify a result</h2>
                  <p>
                    Check the document hashes, identity and signatures in a
                    verification package. Verification confirms integrity and
                    recorded authorization, not factual correctness.
                  </p>
                  <label className="upload-button">
                    <Upload size={16} />
                    Choose verification package
                    <input
                      hidden
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void act("verify", async () => {
                            setProofResult(
                              await api(
                                "/verify",
                                "POST",
                                JSON.parse(await f.text()),
                              ),
                            );
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {proofResult && (
                    <div
                      className={
                        "verification " +
                        (proofResult.valid ? "valid" : "invalid")
                      }
                    >
                      <h3>
                        {proofResult.valid
                          ? "Verification passed"
                          : "Verification failed"}
                      </h3>
                      {Object.entries(proofResult.checks).map(([k, v]) => (
                        <div key={k}>
                          {v ? <Check size={15} /> : <X size={15} />} {k}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
          {page === "Settings" && (
            <div className="settings-grid">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">MODEL CONNECTION</span>
                    <h2>
                      {modelForm.id
                        ? "Edit model connection"
                        : "Add a model connection"}
                    </h2>
                  </div>
                  <Settings2 size={22} />
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("model", async () => {
                      const m = await api<SafeModel>("/models", "POST", {
                        ...modelForm,
                        id: modelForm.id || undefined,
                        apiKey:
                          modelForm.id && !modelForm.apiKey
                            ? undefined
                            : modelForm.apiKey,
                      });
                      setModelId(m.id);
                      await load();
                      setNotice({
                        text: "Model connection saved. Test it before starting a task.",
                      });
                    });
                  }}
                >
                  <label>
                    Connection name
                    <input
                      required
                      value={modelForm.name}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Connection type
                    <select
                      value={modelForm.kind}
                      onChange={(e) =>
                        setModelForm({
                          ...modelForm,
                          kind: e.target.value as "openai" | "ollama",
                        })
                      }
                    >
                      <option value="ollama">Ollama (local)</option>
                      <option value="openai">OpenAI compatible</option>
                    </select>
                  </label>
                  <p className="field-hint">
                    Ollama uses its native chat API to apply the context budget.
                    For OpenAI compatible services, enter the full API base URL
                    including /v1 if needed.
                  </p>
                  <label>
                    API base URL
                    <input
                      type="url"
                      required
                      value={modelForm.baseUrl}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, baseUrl: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Model name
                    <input
                      required
                      value={modelForm.model}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, model: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    API key{" "}
                    <span className="optional">Optional for local models</span>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={
                        modelForm.id ? "Leave blank to keep the saved key" : ""
                      }
                      value={modelForm.apiKey}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, apiKey: e.target.value })
                      }
                    />
                  </label>
                  <div className="field-pair">
                    <label>
                      Context token budget
                      <input
                        type="number"
                        min={4096}
                        max={131072}
                        value={modelForm.contextTokens}
                        onChange={(e) =>
                          setModelForm({
                            ...modelForm,
                            contextTokens: +e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Output token limit
                      <input
                        type="number"
                        min={512}
                        max={8192}
                        value={modelForm.outputTokens}
                        onChange={(e) =>
                          setModelForm({
                            ...modelForm,
                            outputTokens: +e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <button className="primary" disabled={!!busy}>
                    Save connection
                    <Check size={16} />
                  </button>
                  {modelForm.id && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setModelForm({
                          ...modelForm,
                          id: "",
                          name: "New connection",
                          apiKey: "",
                        })
                      }
                    >
                      Add another model
                    </button>
                  )}
                </form>
              </section>
              <aside>
                {models.map((m) => (
                  <section className="panel connection-card" key={m.id}>
                    <div className="section-row">
                      <Settings2 size={23} />
                      <span className="local-tag">
                        {m.hasKey ? "KEY SAVED" : "NO KEY"}
                      </span>
                    </div>
                    <h2>{m.name}</h2>
                    <p>{m.model}</p>
                    <code>{m.baseUrl}</code>
                    <div className="task-actions">
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          void act("test", async () => {
                            await api("/models/" + m.id + "/test", "POST");
                            setNotice({
                              text: "Connection test passed. Chat and structured JSON output are available.",
                            });
                          })
                        }
                      >
                        {busy === "test" ? "Testing…" : "Test connection"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => editModel(m)}
                      >
                        Edit
                      </button>
                    </div>
                  </section>
                ))}
                <div className="help-note">
                  <CircleHelp size={19} />
                  <p>
                    Choose Ollama for a local installed model, or OpenAI
                    compatible for another chat service. A cloud connection
                    receives your selected task context.
                  </p>
                </div>
              </aside>
            </div>
          )}
          {page === "Workspace" && sources.length > 0 && !selected && (
            <details className="library">
              <summary>Manage source library · {sources.length} files</summary>
              {sources.map((s) => (
                <div key={s.id}>
                  <FileText size={15} />
                  <span>{s.name}</span>
                  <button
                    className="icon-button"
                    aria-label={"Remove " + s.name}
                    disabled={!!running}
                    onClick={() =>
                      void act("source", async () => {
                        await api("/sources/" + s.id, "DELETE");
                        setChecked(checked.filter((id) => id !== s.id));
                        await load();
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
        <footer className="app-footer">
          <span>Personal Sovereign Agent</span>
          <span>Your intent. Your authority. Your continuity.</span>
        </footer>
      </main>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <section className="empty panel">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
