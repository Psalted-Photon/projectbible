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
  /** Set in the Android app, which shows them itself; the sender skips it (migration 020). */
  on_phone_app: boolean;
  updated_at: string;
}

/** on_phone_app left out keeps whatever the row already says. */
export type DevotionalReminderUpsert = Omit<
  DevotionalReminderRow,
  'last_morning_on' | 'last_evening_on' | 'on_phone_app' | 'updated_at'
> & { on_phone_app?: boolean };

export async function upsertDevotionalReminders(row: DevotionalReminderUpsert): Promise<void> {
  const { error } = await supabase
    .from('devotional_reminders')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Mark the account's alarm or reminders as rung by the Android app, so the
 * server's sender leaves them alone. Only rows with something switched on; a
 * missing row is left missing.
 */
export async function markOnPhoneApp(userId: string, alarm: boolean, reminders: boolean): Promise<void> {
  const jobs: PromiseLike<{ error: unknown }>[] = [];
  if (alarm) {
    jobs.push(supabase.from('wake_alarms').update({ on_phone_app: true })
      .eq('user_id', userId).eq('on_phone_app', false));
  }
  if (reminders) {
    jobs.push(supabase.from('devotional_reminders').update({ on_phone_app: true })
      .eq('user_id', userId).eq('on_phone_app', false));
  }
  for (const { error } of await Promise.all(jobs)) if (error) throw error;
}
