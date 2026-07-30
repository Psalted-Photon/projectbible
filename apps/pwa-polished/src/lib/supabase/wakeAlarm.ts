import { supabase } from './client';

/**
 * The alarm schedule as the server sees it. The scheduled sender reads these
 * rows every minute, so this is the authoritative copy — localStorage is just
 * what the UI edits before mirroring it here.
 *
 * `last_fired_on` is the local date (YYYY-MM-DD) of the most recent send. The
 * sender uses it to avoid firing twice in one day.
 */
export interface WakeAlarmRow {
  user_id: string;
  enabled: boolean;
  time_local: string;   // 'HH:MM'
  days: number[];       // 0=Sunday … 6=Saturday; empty means every day
  timezone: string;     // IANA name, e.g. 'America/Chicago'
  source: 'continue' | 'chapter' | 'plan';
  book: string | null;
  chapter: number | null;
  last_fired_on: string | null;
  updated_at: string;
}

export type WakeAlarmUpsert = Omit<WakeAlarmRow, 'last_fired_on' | 'updated_at'>;

export async function upsertWakeAlarm(row: WakeAlarmUpsert): Promise<WakeAlarmRow> {
  const { data, error } = await supabase
    .from('wake_alarms')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as WakeAlarmRow;
}

export async function fetchWakeAlarm(userId: string): Promise<WakeAlarmRow | null> {
  const { data, error } = await supabase
    .from('wake_alarms')
    .select('*')
    .eq('user_id', userId)
    .single();

  // PGRST116 is "no rows" — an account that has never set an alarm.
  if (error && error.code !== 'PGRST116') throw error;

  return (data as WakeAlarmRow) ?? null;
}
