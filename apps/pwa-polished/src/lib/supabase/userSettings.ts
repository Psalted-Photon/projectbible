import { supabase } from './client';

export interface UserSettingsRow {
  user_id: string;
  settings: Record<string, any>;
  updated_at: string;
}

export async function upsertUserSettings(userId: string, settings: Record<string, any>) {
  const { data, error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as UserSettingsRow;
}

export async function fetchUserSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return (data as UserSettingsRow) ?? null;
}
