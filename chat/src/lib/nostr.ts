import { EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { initNostrWasm } from "nostr-wasm";
import { extraRelays$, lookupRelays$ } from "./settings";

// Initialize nostr-wasm for signature verification
const nw = await initNostrWasm();

// Create in-memory event store
export const eventStore = new EventStore();

// Use nostr-wasm to verify all events added to the store
eventStore.verifyEvent = (e) => {
  try {
    nw.verifyEvent(e);
    return true;
  } catch {
    return false;
  }
};

// Create relay connection pool
export const pool = new RelayPool();

// Attach loaders to event store
export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: extraRelays$,
});

if (import.meta.env.DEV) {
  // @ts-ignore
  window.eventStore = eventStore;

  // @ts-ignore
  window.pool = pool;
}
