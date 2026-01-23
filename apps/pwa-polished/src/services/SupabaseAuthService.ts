import type { AuthResponse, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";

export class SupabaseAuthService {
  async signUp(email: string, password: string): Promise<AuthResponse> {
    return supabase.auth.signUp({ email, password });
  }

  async signIn(email: string, password: string): Promise<AuthResponse> {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
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
