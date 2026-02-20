import { openDB, readTransaction, writeTransaction } from "../adapters/db";
import type { PlanMetadataRow } from "../lib/supabase/types";

export type PlanStatus = "active" | "completed" | "archived";

export interface PlanMetadata {
  planId: string;
  status: PlanStatus;
  planDefinitionHash: string;
  planVersion: number;
  activatedAt: number;
  archivedAt?: number;
  lastSyncedAt?: number;
  syncConflicts?: any[];
  catchUpAdjustment?: any;
}

export class PlanMetadataStore {
  async getPlanMetadata(planId: string): Promise<PlanMetadata | undefined> {
    const record = await readTransaction("plan_metadata", (store) => store.get(planId));
    if (!record) return undefined;
    return this.deserialize(record);
  }

  async getPlansByStatus(status: PlanStatus): Promise<PlanMetadata[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("plan_metadata", "readonly");
      const store = tx.objectStore("plan_metadata");
      const index = store.index("status");
      const request = index.getAll(status);

      request.onsuccess = () => {
        resolve((request.result || []).map((record) => this.deserialize(record)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(): Promise<PlanMetadata[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("plan_metadata", "readonly");
      const store = tx.objectStore("plan_metadata");
      const request = store.getAll();

      request.onsuccess = () => {
        resolve((request.result || []).map((record) => this.deserialize(record)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async upsertPlanMetadata(metadata: PlanMetadata): Promise<void> {
    await writeTransaction("plan_metadata", (store) => store.put(this.serialize(metadata)));
  }

  async setPlanStatus(planId: string, status: PlanStatus): Promise<void> {
    const existing = await this.getPlanMetadata(planId);
    if (!existing) return;

    const updated: PlanMetadata = {
      ...existing,
      status,
      archivedAt: status === "archived" ? Date.now() : existing.archivedAt,
    };

    await this.upsertPlanMetadata(updated);
  }

  async applyCloudRow(row: PlanMetadataRow): Promise<void> {
    const metadata: PlanMetadata = {
      planId: row.out_plan_id,
      status: row.out_status as PlanStatus,
      planDefinitionHash: row.out_plan_definition_hash,
      planVersion: row.out_plan_version,
      activatedAt: row.out_activated_at ? new Date(row.out_activated_at).getTime() : Date.now(),
      archivedAt: row.out_archived_at ? new Date(row.out_archived_at).getTime() : undefined,
      lastSyncedAt: row.out_last_synced_at ? new Date(row.out_last_synced_at).getTime() : undefined,
      syncConflicts: row.out_sync_conflicts ?? undefined,
      catchUpAdjustment: row.out_catch_up_adjustment ?? undefined,
    };

    await this.upsertPlanMetadata(metadata);
  }

  async applyDirectRow(row: any): Promise<void> {
    const metadata: PlanMetadata = {
      planId: row.plan_id,
      status: row.status as PlanStatus,
      planDefinitionHash: row.plan_definition_hash,
      planVersion: row.plan_version,
      activatedAt: row.activated_at ? new Date(row.activated_at).getTime() : Date.now(),
      archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).getTime() : undefined,
      syncConflicts: row.sync_conflicts ?? undefined,
      catchUpAdjustment: row.catch_up_adjustment ?? undefined,
    };

    await this.upsertPlanMetadata(metadata);
  }

  private serialize(metadata: PlanMetadata) {
    return {
      planId: metadata.planId,
      status: metadata.status,
      planDefinitionHash: metadata.planDefinitionHash,
      planVersion: metadata.planVersion,
      activatedAt: metadata.activatedAt,
      archivedAt: metadata.archivedAt,
      lastSyncedAt: metadata.lastSyncedAt,
      syncConflicts: metadata.syncConflicts ? JSON.stringify(metadata.syncConflicts) : undefined,
      catchUpAdjustment: metadata.catchUpAdjustment
        ? JSON.stringify(metadata.catchUpAdjustment)
        : undefined,
    };
  }

  private deserialize(record: any): PlanMetadata {
    return {
      planId: record.planId,
      status: record.status,
      planDefinitionHash: record.planDefinitionHash,
      planVersion: record.planVersion,
      activatedAt: record.activatedAt,
      archivedAt: record.archivedAt ?? undefined,
      lastSyncedAt: record.lastSyncedAt ?? undefined,
      syncConflicts: record.syncConflicts ? JSON.parse(record.syncConflicts) : undefined,
      catchUpAdjustment: record.catchUpAdjustment
        ? JSON.parse(record.catchUpAdjustment)
        : undefined,
    };
  }
}

export const planMetadataStore = new PlanMetadataStore();
