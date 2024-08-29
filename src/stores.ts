import { writable, type Writable } from 'svelte/store';

export const duesStoreType: Writable<string> = writable('1');
