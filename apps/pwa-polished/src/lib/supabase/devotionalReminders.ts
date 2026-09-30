import { supabase } from './client';

/**
 * The devotional reminder times as the server sees them (migration 015). The
 * scheduled sender reads these every minute; the settings blob is what the UI
 * edits before mirroring here. last_morning_on / last_evening_on are written by
 * the sender only.
 */
export interface DevotionalReminderRow {
  user_id: string;
  morning_enabled: boolean;
  morning_time: string; // 'HH:MM'
  evening_enabled: boolean;
  evening_time: string; // 'HH:MM'
  timezone: string;     // IANA name
  last_morning_on: string | null;
  last_evening_on: string | null;
  updated_at: string;
}

export type DevotionalReminderUpsert = Omit<DevotionalReminderRow, 'last_morning_on' | 'last_evening_on' | 'updated_at'>;

export async function upsertDevotionalReminders(row: DevotionalReminderUpsert): Promise<void> {
  const { error } = await supabase
    .from('devotional_reminders')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
