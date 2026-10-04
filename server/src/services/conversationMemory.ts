import type { ConversationTurn } from "./llmProvider.js";

interface SessionMemory {
  turns: ConversationTurn[];
  lastUsedAt: number;
}

export interface ConversationMemoryOptions {
  maxSessions?: number;
  maxTurns?: number;
  maxTextLength?: number;
  ttlMs?: number;
  now?: () => number;
}

/** Volatile, bounded short-term context. It is never written to storage and starts empty on process restart. */
export class ConversationMemory {
  private readonly sessions = new Map<string, SessionMemory>();
  private readonly maxSessions: number;
  private readonly maxTurns: number;
  private readonly maxTextLength: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ConversationMemoryOptions = {}) {
    this.maxSessions = Math.max(1, options.maxSessions ?? 1_000);
    this.maxTurns = Math.max(1, options.maxTurns ?? 8);
    this.maxTextLength = Math.max(1, options.maxTextLength ?? 500);
    this.ttlMs = Math.max(1, options.ttlMs ?? 2 * 60 * 60 * 1_000);
    this.now = options.now ?? Date.now;
  }

  getContext(sessionId: string): ConversationTurn[] {
    const key = sessionId.trim();
    if (!key) return [];

    const now = this.now();
    this.expireInactive(now);
    const session = this.sessions.get(key);
    if (!session) return [];

    this.touch(key, session, now);
    return session.turns.map((turn) => ({ ...turn }));
  }

  remember(sessionId: string, text: string): void {
    const key = sessionId.trim();
    const cleanedText = text.trim().slice(0, this.maxTextLength);
    if (!key || !cleanedText) return;

    const now = this.now();
    this.expireInactive(now);
    const session = this.sessions.get(key) ?? { turns: [], lastUsedAt: now };
    session.turns.push({ role: "user", text: cleanedText });
    if (session.turns.length > this.maxTurns) session.turns.splice(0, session.turns.length - this.maxTurns);
    this.touch(key, session, now);

    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
  }

  clear(sessionId: string): void {
    const key = sessionId.trim();
    if (key) this.sessions.delete(key);
  }

  private touch(key: string, session: SessionMemory, now: number): void {
    session.lastUsedAt = now;
    this.sessions.delete(key);
    this.sessions.set(key, session);
  }

  private expireInactive(now: number): void {
    for (const [key, session] of this.sessions) {
      if (now - session.lastUsedAt >= this.ttlMs) this.sessions.delete(key);
    }
  }
}
