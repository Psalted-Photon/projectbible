import { writable } from 'svelte/store';

export interface UserProfileState {
  name: string | null;
  email: string | null;
  isSignedIn: boolean;
  userId: string | null;
}

const initialState: UserProfileState = {
  name: null,
  email: null,
  isSignedIn: false,
  userId: null,
};

function createUserProfileStore() {
  const { subscribe, set } = writable<UserProfileState>(initialState);

  return {
    subscribe,
    setFromSession: (session: { user?: { id?: string; email?: string | null; user_metadata?: any } } | null) => {
      if (!session?.user) {
        set(initialState);
        return;
      }
      set({
        name: session.user.user_metadata?.name ?? null,
        email: session.user.email ?? null,
        isSignedIn: true,
        userId: session.user.id ?? null,
      });
    },
    clear: () => set(initialState),
  };
}

export const userProfileStore = createUserProfileStore();
