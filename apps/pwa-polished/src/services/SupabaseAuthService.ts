import type { AuthResponse, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";

export class SupabaseAuthService {
  async signUp(email: string, password: string, name: string): Promise<AuthResponse> {
    return supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });
  }

  async signIn(email: string, password: string): Promise<AuthResponse> {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  async resetPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async reauthenticate(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async updateProfileName(name: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({
      data: {
        name,
      },
    });
    if (error) throw error;
  }

  async deleteAccount(): Promise<void> {
    const { error } = await supabase.rpc('delete_account');
    if (error) throw error;
  }

  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  }

  onAuthStateChange(handler: (event: string, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => handler(event, session));
  }
}

export const supabaseAuthService = new SupabaseAuthService();
