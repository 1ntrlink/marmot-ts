import { EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { extraRelays$, lookupRelays$ } from "./settings";

import { initNostrWasm } from "nostr-wasm";
const nw = await initNostrWasm();

// Create in-memory event store
export const eventStore = new EventStore();

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
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: extraRelays$,
});

if (import.meta.env.DEV) {
  // @ts-ignore
  window.eventStore = eventStore;

  // @ts-ignore
  window.pool = pool;
}
