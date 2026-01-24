import { openDB, readTransaction, writeTransaction, batchWriteTransaction, generateId } from "../adapters/db";
import { syncReadingProgress, syncPlanMetadata } from "../lib/sync/SyncService";
import { supabaseAuthService } from "./SupabaseAuthService";
import { readingProgressStore } from "../stores/ReadingProgressStore";
import { planMetadataStore, type PlanStatus } from "../stores/PlanMetadataStore";

export type SyncQueueStatus = "pending" | "processing" | "failed" | "done";
export type SyncQueueType =
  | "chapter-toggle"
  | "day-complete"
  | "day-incomplete"
  | "catch-up-apply"
  | "plan-status-change"
  | "manual-sync";

export interface ChapterTogglePayload {
  planId: string;
  dayNumber: number;
  chapter: { book: string; chapter: number };
  action: "checked" | "unchecked";
  timestamp: number;
}

export interface DayStatusPayload {
  planId: string;
  dayNumber: number;
  completed: boolean;
  completedAt?: number;
  chaptersRead?: any[];
}

export interface CatchUpPayload {
  planId: string;
  mode: "spread" | "dedicated";
  appliedAt: number;
  data: any;
}

export interface PlanStatusPayload {
  planId: string;
  status: PlanStatus;
}

export interface ManualSyncPayload {
  planId: string;
  reason: string;
}

export type SyncQueuePayload =
  | ChapterTogglePayload
  | DayStatusPayload
  | CatchUpPayload
  | PlanStatusPayload
  | ManualSyncPayload;

export interface SyncQueueItem {
  id: string;
  type: SyncQueueType;
  payload: SyncQueuePayload;
  operationId: string;
  priority: number;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  status: SyncQueueStatus;
  lastError?: string;
  planId?: string;
}

export interface SyncQueueStats {
  pending: number;
  processing: number;
  failed: number;
  done: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

const MAX_ATTEMPTS = 5;
const CHAPTER_DEBOUNCE_MS = 5000;
const LAST_SYNC_KEY = "projectbible_last_sync_at";

function createOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return generateId();
}

export class SyncOrchestrator {
  private subscribers = new Set<(stats: SyncQueueStats) => void>();
  private processing = false;
  private debounceTimer: number | null = null;
  private retryTimer: number | null = null;
  private lastError: string | null = null;

  subscribe(handler: (stats: SyncQueueStats) => void): () => void {
    this.subscribers.add(handler);
    this.emitStats().catch(() => undefined);
    return () => this.subscribers.delete(handler);
  }

  async enqueue(type: SyncQueueType, payload: SyncQueuePayload, priority: number): Promise<void> {
    const planId = "planId" in payload ? payload.planId : undefined;
    const existing =
      type === "chapter-toggle" && planId
        ? await this.findPendingByTypeAndPlan(type, planId)
        : undefined;

    if (existing) {
      const updated: SyncQueueItem = {
        ...existing,
        payload,
        createdAt: Date.now(),
        status: "pending",
        lastError: undefined,
      };
      await writeTransaction("sync_queue", (store) => store.put(updated));
      this.scheduleDebounced();
      await this.emitStats();
      return;
    }

    const item: SyncQueueItem = {
      id: createOperationId(),
      type,
      payload,
      operationId: createOperationId(),
      priority,
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      status: "pending",
      planId,
    };

    await writeTransaction("sync_queue", (store) => store.put(item));

    if (type === "chapter-toggle") {
      this.scheduleDebounced();
    } else {
      void this.processQueue();
    }

    await this.emitStats();
  }

  async runImmediateSync(planId: string, reason: string): Promise<void> {
    const userId = await this.getUserId();
    if (!userId) return;

    this.lastError = null;
    await this.emitStats();

    try {
      const entries = await readingProgressStore.getProgressForPlan(planId);
      for (const entry of entries) {
        const result = await syncReadingProgress({
          operationId: createOperationId(),
          userId,
          planId: entry.planId,
          dayNumber: entry.dayNumber,
          completed: entry.completed,
          completedAt: entry.completedAt ? new Date(entry.completedAt).toISOString() : null,
          startedReadingAt: entry.startedReadingAt
            ? new Date(entry.startedReadingAt).toISOString()
            : null,
          chaptersRead: entry.chaptersRead ?? [],
          catchUpAdjustment: entry.catchUpAdjustment ?? null,
        });
        if (result) {
          await readingProgressStore.applyCloudRow(result);
        }
      }

      const metadata = await planMetadataStore.getPlanMetadata(planId);
      if (metadata) {
        const metaResult = await syncPlanMetadata({
          operationId: createOperationId(),
          userId,
          planId: metadata.planId,
          status: metadata.status,
          planDefinitionHash: metadata.planDefinitionHash,
          planVersion: metadata.planVersion,
          activatedAt: new Date(metadata.activatedAt).toISOString(),
          archivedAt: metadata.archivedAt ? new Date(metadata.archivedAt).toISOString() : null,
          lastSyncedAt: metadata.lastSyncedAt ? new Date(metadata.lastSyncedAt).toISOString() : null,
          syncConflicts: metadata.syncConflicts ?? null,
          catchUpAdjustment: metadata.catchUpAdjustment ?? null,
        });
        if (metaResult) {
          await planMetadataStore.applyCloudRow(metaResult);
        }
      }

      await this.markPlanItemsDone(planId);
      this.setLastSyncedAt(Date.now());
    } catch (error) {
      this.lastError = this.formatError(error);
      throw error;
    } finally {
      await this.emitStats();
    }
  }

  async processQueue(): Promise<void> {
    if (this.processing) return;
    const canSync = await this.canSync();
    if (!canSync) return;

    this.processing = true;
    this.lastError = null;
    await this.emitStats();

    try {
      const pending = await this.getPendingItems();
      pending.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.createdAt - b.createdAt;
      });

      for (const item of pending) {
        const alreadyApplied = await this.isOperationApplied(item.operationId);
        if (alreadyApplied) {
          await this.markDone(item);
          continue;
        }

        await this.markProcessing(item);
        try {
          await this.executeItem(item);
          await this.markDone(item);
          await this.recordOperation(item.operationId);
          this.setLastSyncedAt(Date.now());
        } catch (error) {
          const shouldContinue = await this.handleError(item, error);
          if (!shouldContinue) break;
        }
      }
    } finally {
      this.processing = false;
      await this.emitStats();
    }
  }

  async retryFailed(): Promise<void> {
    const failed = await this.getItemsByStatus("failed");
    if (failed.length === 0) return;
    await batchWriteTransaction("sync_queue", (store) => {
      failed.forEach((item) => {
        store.put({
          ...item,
          status: "pending",
          lastError: undefined,
        });
      });
    });
    void this.processQueue();
    await this.emitStats();
  }

  async getQueueStats(): Promise<SyncQueueStats> {
    const items = await this.getAllItems();
    return this.buildStats(items);
  }

  private async executeItem(item: SyncQueueItem): Promise<void> {
    const planId = item.planId ?? ("planId" in item.payload ? item.payload.planId : undefined);
    if (!planId) {
      throw new Error("Missing planId for sync item");
    }
    const userId = await this.getUserId();
    if (!userId) {
      throw new Error("No signed-in user for sync");
    }

    if (item.type === "plan-status-change" || item.type === "catch-up-apply") {
      const metadata = await planMetadataStore.getPlanMetadata(planId);
      if (!metadata) return;
      const result = await syncPlanMetadata({
        operationId: item.operationId,
        userId,
        planId: metadata.planId,
        status: metadata.status,
        planDefinitionHash: metadata.planDefinitionHash,
        planVersion: metadata.planVersion,
        activatedAt: new Date(metadata.activatedAt).toISOString(),
        archivedAt: metadata.archivedAt ? new Date(metadata.archivedAt).toISOString() : null,
        lastSyncedAt: metadata.lastSyncedAt ? new Date(metadata.lastSyncedAt).toISOString() : null,
        syncConflicts: metadata.syncConflicts ?? null,
        catchUpAdjustment: metadata.catchUpAdjustment ?? null,
      });
      if (result) {
        await planMetadataStore.applyCloudRow(result);
      }
      return;
    }

    const dayNumber = (item.payload as any).dayNumber;
    if (typeof dayNumber !== "number") {
      throw new Error("Missing day number for reading progress sync");
    }

    const entry = await readingProgressStore.getDayProgress(planId, dayNumber);
    if (!entry) return;

    const result = await syncReadingProgress({
      operationId: item.operationId,
      userId,
      planId: entry.planId,
      dayNumber: entry.dayNumber,
      completed: entry.completed,
      completedAt: entry.completedAt ? new Date(entry.completedAt).toISOString() : null,
      startedReadingAt: entry.startedReadingAt
        ? new Date(entry.startedReadingAt).toISOString()
        : null,
      chaptersRead: entry.chaptersRead ?? [],
      catchUpAdjustment: entry.catchUpAdjustment ?? null,
    });

    if (result) {
      await readingProgressStore.applyCloudRow(result);
    }
  }

  private async getUserId(): Promise<string | null> {
    const session = await supabaseAuthService.getSession();
    return session?.user?.id ?? null;
  }

  private async canSync(): Promise<boolean> {
    if (typeof navigator !== "undefined" && !navigator.onLine) return false;
    const session = await supabaseAuthService.getSession();
    return Boolean(session);
  }

  private scheduleDebounced() {
    if (this.debounceTimer) {
      globalThis.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = globalThis.setTimeout(() => {
      this.debounceTimer = null;
      void this.processQueue();
    }, CHAPTER_DEBOUNCE_MS) as unknown as number;
  }

  private async handleError(item: SyncQueueItem, error: unknown): Promise<boolean> {
    const attempts = item.attempts + 1;
    const now = Date.now();
    const lastError = this.formatError(error);

    this.lastError = lastError;

    if (attempts >= MAX_ATTEMPTS) {
      await writeTransaction("sync_queue", (store) =>
        store.put({
          ...item,
          attempts,
          lastAttemptAt: now,
          status: "failed",
          lastError,
        }),
      );
      return false;
    }

    await writeTransaction("sync_queue", (store) =>
      store.put({
        ...item,
        attempts,
        lastAttemptAt: now,
        status: "pending",
        lastError,
      }),
    );

    const delay = this.getBackoffDelay(attempts);
    if (!this.retryTimer) {
      this.retryTimer = globalThis.setTimeout(() => {
        this.retryTimer = null;
        void this.processQueue();
      }, delay) as unknown as number;
    }
    return false;
  }

  private getBackoffDelay(attempts: number): number {
    const base = Math.pow(2, attempts) * 1000;
    const jitter = Math.floor(Math.random() * 500);
    return Math.min(60000, base + jitter);
  }

  private async findPendingByTypeAndPlan(type: SyncQueueType, planId: string): Promise<SyncQueueItem | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_queue", "readonly");
      const store = tx.objectStore("sync_queue");
      const index = store.index("type_planId");
      const request = index.getAll(IDBKeyRange.only([type, planId]));

      request.onsuccess = () => {
        const match = (request.result as SyncQueueItem[]).find((item) => item.status === "pending");
        resolve(match);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async getPendingItems(): Promise<SyncQueueItem[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_queue", "readonly");
      const store = tx.objectStore("sync_queue");
      const request = store.getAll();

      request.onsuccess = () => {
        const items = (request.result as SyncQueueItem[]).filter((item) => item.status === "pending");
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async getItemsByStatus(status: SyncQueueStatus): Promise<SyncQueueItem[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains("sync_queue")) {
      return [];
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_queue", "readonly");
      const store = tx.objectStore("sync_queue");
      const index = store.index("status");
      const request = index.getAll(status);

      request.onsuccess = () => resolve((request.result as SyncQueueItem[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  private async getAllItems(): Promise<SyncQueueItem[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains("sync_queue")) {
      return [];
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_queue", "readonly");
      const store = tx.objectStore("sync_queue");
      const request = store.getAll();

      request.onsuccess = () => resolve((request.result as SyncQueueItem[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  private async markProcessing(item: SyncQueueItem): Promise<void> {
    await writeTransaction("sync_queue", (store) =>
      store.put({
        ...item,
        status: "processing",
        lastAttemptAt: Date.now(),
      }),
    );
    await this.emitStats();
  }

  private async markDone(item: SyncQueueItem): Promise<void> {
    await writeTransaction("sync_queue", (store) =>
      store.put({
        ...item,
        status: "done",
        lastError: undefined,
      }),
    );
    await this.emitStats();
  }

  private async markPlanItemsDone(planId: string): Promise<void> {
    const db = await openDB();
    if (!db.objectStoreNames.contains("sync_queue")) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_queue", "readwrite");
      const store = tx.objectStore("sync_queue");
      const index = store.index("planId");
      const request = index.getAll(planId);

      request.onsuccess = () => {
        const items = request.result as SyncQueueItem[];
        items.forEach((item) => {
          store.put({
            ...item,
            status: "done",
            lastError: undefined,
          });
        });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async isOperationApplied(operationId: string): Promise<boolean> {
    const db = await openDB();
    if (!db.objectStoreNames.contains("sync_operations")) {
      return false;
    }
    const record = await readTransaction("sync_operations", (store) => store.get(operationId));
    return Boolean(record);
  }

  private async recordOperation(operationId: string): Promise<void> {
    const db = await openDB();
    if (!db.objectStoreNames.contains("sync_operations")) {
      return;
    }
    await writeTransaction("sync_operations", (store) =>
      store.put({
        operationId,
        appliedAt: Date.now(),
      }),
    );
  }

  private setLastSyncedAt(timestamp: number) {
    localStorage.setItem(LAST_SYNC_KEY, String(timestamp));
  }

  private getLastSyncedAt(): number | null {
    const value = localStorage.getItem(LAST_SYNC_KEY);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async emitStats(): Promise<void> {
    const stats = await this.getQueueStats();
    this.subscribers.forEach((handler) => handler(stats));
  }

  private buildStats(items: SyncQueueItem[]): SyncQueueStats {
    const pending = items.filter((i) => i.status === "pending").length;
    const processing = items.filter((i) => i.status === "processing").length;
    const failed = items.filter((i) => i.status === "failed").length;
    const done = items.filter((i) => i.status === "done").length;
    return {
      pending,
      processing,
      failed,
      done,
      lastSyncedAt: this.getLastSyncedAt(),
      lastError: this.lastError,
    };
  }

  private formatError(error: unknown): string {
    if (!error) return "Unknown error";
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Sync error";
  }
}

export const syncOrchestrator = new SyncOrchestrator();
