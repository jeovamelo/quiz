export type ConversationEntry = {
  id?: number;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

// ─── IndexedDB history ────────────────────────────────────────────────────────

class SessionHistoryDB {
  private db: IDBDatabase | null = null;
  private readonly NAME = "quizbini-ai-history";
  private readonly STORE = "messages";

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const s = db.createObjectStore(this.STORE, { keyPath: "id", autoIncrement: true });
          s.createIndex("sessionId", "sessionId");
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }

  async add(entry: Omit<ConversationEntry, "id">): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBySession(sessionId: string): Promise<ConversationEntry[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readonly");
      const req = tx.objectStore(this.STORE).index("sessionId").getAll(sessionId);
      req.onsuccess = () => resolve(req.result as ConversationEntry[]);
      req.onerror = () => reject(req.error);
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      const req = tx.objectStore(this.STORE).index("sessionId")
        .openKeyCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursor | null>).result;
        if (cursor) { cursor.delete(); cursor.continue(); } else resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export const historyDB = new SessionHistoryDB();

// ─── AI engine ───────────────────────────────────────────────────────────────

export type ModelProgress = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  percent: number;
};

type ProgressListener = (p: ModelProgress) => void;

// Default lightweight model: ~150 MB quantized, instruction-tuned, multilingual
export const DEFAULT_MODEL = "Xenova/LaMini-Flan-T5-77M";

class LocalAIEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private _progress: ModelProgress = { status: "idle", message: "", percent: 0 };
  private listeners = new Set<ProgressListener>();

  subscribe(fn: ProgressListener): () => void {
    this.listeners.add(fn);
    fn(this._progress);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<ModelProgress>) {
    this._progress = { ...this._progress, ...patch };
    this.listeners.forEach(fn => fn(this._progress));
  }

  isReady() { return this._progress.status === "ready"; }
  isLoading() { return this._progress.status === "loading"; }
  getProgress() { return this._progress; }

  async load(modelId = DEFAULT_MODEL): Promise<void> {
    if (this._progress.status === "ready" || this._progress.status === "loading") return;
    this.emit({ status: "loading", message: "Iniciando download do modelo…", percent: 0 });

    try {
      // Dynamic import keeps this out of the SSR bundle
      const { pipeline, env } = await import("@xenova/transformers");
      // Use CDN-hosted WASM to avoid Vite bundling issues
      (env as Record<string, unknown>).allowLocalModels = false;
      (env as Record<string, unknown>).useBrowserCache = true;

      this.pipe = await pipeline("text2text-generation", modelId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (info: any) => {
          if (info.status === "progress") {
            const pct = Math.round(info.progress ?? 0);
            const file = (info.file as string | undefined)?.split("/").pop() ?? "";
            this.emit({ message: `Baixando ${file}…`, percent: pct });
          } else if (info.status === "loading") {
            this.emit({ message: "Carregando pesos na memória…", percent: 98 });
          } else if (info.status === "loaded") {
            this.emit({ status: "ready", message: "Modelo pronto!", percent: 100 });
          }
        },
      });

      this.emit({ status: "ready", message: "Modelo pronto!", percent: 100 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar modelo.";
      this.emit({ status: "error", message: msg, percent: 0 });
      throw err;
    }
  }

  async generateResponse(opts: {
    question: string;
    context?: string;
    sessionId?: string;
    maxTokens?: number;
  }): Promise<string> {
    if (!this.pipe || !this.isReady()) throw new Error("Modelo ainda não carregado.");
    const { question, context = "", sessionId, maxTokens = 200 } = opts;

    let historyPrefix = "";
    if (sessionId) {
      const history = await historyDB.getBySession(sessionId);
      const recent = history.slice(-6);
      if (recent.length) {
        historyPrefix =
          recent.map(h => `${h.role === "user" ? "Pergunta" : "Resposta"}: ${h.text}`).join("\n") + "\n\n";
      }
    }

    const prompt = [
      context ? `Contexto da apresentação: ${context}` : "",
      historyPrefix,
      `Responda em português à seguinte pergunta: ${question}`,
    ]
      .filter(Boolean)
      .join("\n");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await this.pipe(prompt, { max_new_tokens: maxTokens });
    const answer: string = Array.isArray(result)
      ? (result[0]?.generated_text ?? "")
      : (result?.generated_text ?? "");

    if (sessionId) {
      const ts = Date.now();
      await historyDB.add({ sessionId, role: "user", text: question, timestamp: ts });
      await historyDB.add({ sessionId, role: "assistant", text: answer, timestamp: ts + 1 });
    }

    return answer;
  }
}

// Singleton shared across the app
export const localAI = new LocalAIEngine();
