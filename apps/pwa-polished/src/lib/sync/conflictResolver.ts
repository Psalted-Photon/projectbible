/**
 * Conflict resolution for sync operations
 * Uses last-write-wins strategy based on updated_at timestamps
 */

/**
 * Determine if a remote change should be applied based on timestamps
 * Returns true if remote is newer than local
 */
export function shouldApplyRemoteChange(
  localUpdatedAt: Date | number | null | undefined,
  remoteUpdatedAt: Date | string | null | undefined
): boolean {
  // If no local data, always apply remote
  if (localUpdatedAt == null) return true;
  
  // If no remote timestamp, don't apply
  if (remoteUpdatedAt == null) return false;
  
  const localTs = typeof localUpdatedAt === 'number' 
    ? localUpdatedAt 
    : localUpdatedAt.getTime();
  
  const remoteTs = typeof remoteUpdatedAt === 'string'
    ? new Date(remoteUpdatedAt).getTime()
    : remoteUpdatedAt instanceof Date 
      ? remoteUpdatedAt.getTime()
      : remoteUpdatedAt;
  
  return remoteTs > localTs;
}

/**
 * Get the current timestamp in ISO format for Supabase
 */
export function nowISO(): string {
  return new Date().toISOString();
}
