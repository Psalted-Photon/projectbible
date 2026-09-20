import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";

/**
 * Sign-up finished, but Supabase may have quietly done nothing.
 * `alreadyRegistered` is the one case the API refuses to call an error: with
 * email confirmations on it hands back a decoy user with no identities rather
 * than admit the address is taken, so the caller has to notice it here.
 */
export interface SignUpOutcome {
  alreadyRegistered: boolean;
}

export class SupabaseAuthService {
  async signUp(email: string, password: string, name: string): Promise<SignUpOutcome> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Without this the link goes wherever the dashboard Site URL points,
        // which is not necessarily the app the person signed up in.
        emailRedirectTo: window.location.origin,
        data: {
          name,
        },
      },
    });
    if (error) throw error;
    return { alreadyRegistered: (data.user?.identities?.length ?? 0) === 0 };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  /** Send the confirmation email again — the "didn't arrive?" button. */
  async resendSignUpEmail(email: string): Promise<void> {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
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
