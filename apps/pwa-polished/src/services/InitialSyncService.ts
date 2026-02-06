import { supabase } from '../lib/supabase/client';
import { syncService } from './SyncService';
import { planMetadataStore } from '../stores/PlanMetadataStore';

/**
 * InitialSyncService handles pulling cloud data when user signs in.
 * This fixes the broken sync by ensuring cloud data is merged BEFORE loading local data.
 */
class InitialSyncService {
  async pullAll(userId: string) {
    console.log('[InitialSync] Starting initial pull for user:', userId);
    
    const result = {
      plansPulled: 0,
      progressSynced: 0,
      conflicts: [] as string[],
      errors: [] as string[]
    };

    try {
      // Step 1: Fetch all plan metadata from cloud
      console.log('[InitialSync] Fetching plan metadata from cloud...');
      const { data: cloudPlans, error: plansError } = await supabase
        .from('plan_metadata')
        .select('*')
        .eq('user_id', userId);

      if (plansError) {
        console.error('[InitialSync] Error fetching plan metadata:', plansError);
        result.errors.push(`Plan metadata fetch failed: ${plansError.message}`);
        return result;
      }

      console.log(`[InitialSync] Found ${cloudPlans?.length || 0} plans in cloud`);

      if (!cloudPlans || cloudPlans.length === 0) {
        console.log('[InitialSync] No cloud plans found, nothing to sync');
        return result;
      }

      // Step 2: Apply each plan's metadata to local store
      for (const cloudPlan of cloudPlans) {
        try {
          await planMetadataStore.applyCloudRow(cloudPlan);
          result.plansPulled++;
          console.log(`[InitialSync] Applied plan metadata: ${cloudPlan.plan_id}`);
        } catch (error) {
          console.error(`[InitialSync] Error applying plan ${cloudPlan.plan_id}:`, error);
          result.errors.push(`Plan ${cloudPlan.plan_id}: ${error}`);
        }
      }

      // Step 3: Sync reading progress for each plan (pull + merge + push)
      for (const cloudPlan of cloudPlans) {
        try {
          console.log(`[InitialSync] Syncing progress for plan: ${cloudPlan.plan_id}`);
          await syncService.syncReadingProgress(cloudPlan.plan_id);
          result.progressSynced++;
        } catch (error) {
          console.error(`[InitialSync] Error syncing progress for ${cloudPlan.plan_id}:`, error);
          result.errors.push(`Progress sync ${cloudPlan.plan_id}: ${error}`);
        }
      }

      // Step 4: Push any local-only plans to cloud
      try {
        console.log('[InitialSync] Pushing local plan metadata to cloud...');
        await syncService.syncPlanMetadata();
      } catch (error) {
        console.error('[InitialSync] Error pushing plan metadata:', error);
        result.errors.push(`Plan metadata push failed: ${error}`);
      }

      console.log('[InitialSync] Complete:', result);

      if (result.errors.length > 0) {
        console.warn('[InitialSync] Completed with errors:', result.errors);
      }

    } catch (error) {
      console.error('[InitialSync] Unexpected error during initial sync:', error);
      result.errors.push(`Unexpected error: ${error}`);
    }

    return result;
  }

  /**
   * Clear all cloud data for a user (useful for testing or account deletion)
   */
  async clearCloudData(userId: string) {
    console.log('[InitialSync] Clearing all cloud data for user:', userId);
    
    try {
      await supabase.from('reading_progress').delete().eq('user_id', userId);
      await supabase.from('plan_metadata').delete().eq('user_id', userId);
      console.log('[InitialSync] Cloud data cleared successfully');
    } catch (error) {
      console.error('[InitialSync] Error clearing cloud data:', error);
      throw error;
    }
  }
}

export const initialSyncService = new InitialSyncService();
