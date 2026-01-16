import { writable } from 'svelte/store';

export const searchQuery = writable<string>('');
export const triggerSearch = writable<number>(0); // Incremented to trigger search
