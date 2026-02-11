import localforage from "localforage";
import { BehaviorSubject, map, shareReplay, switchMap } from "rxjs";
import { GroupStore } from "../../../src";
import accounts from "./accounts";

// BehaviorSubject for the currently selected group ID
export const selectedGroupId$ = new BehaviorSubject<string | null>(null);
// TODO: not reactive after v2 refactor
// Create and export a shared GroupStore instance
// Note: This only emits when the account changes, not on every store update.
// The onUpdate callback still fires to notify other parts of the app about changes.
export const groupStore$ = accounts.active$.pipe(
  map((account) => {
    // IMPORTANT: keep this storage namespace in sync with the backend used by
    // [`examples.src.lib.marmot-client.ts`](examples/src/lib/marmot-client.ts:77).
    // Otherwise groups created via MarmotClient won't appear in UIs that read
    // from GroupStore (e.g. Add Member).
    return new GroupStore(
      localforage.createInstance({
        name: `marmot-group-store-${account?.pubkey ?? "anon"}`,
      }),
    );
  }),
  shareReplay(1),
);

// Observable for the count of groups in the store
// Note: This updates when the store instance changes (account change).
// For reactive updates on group additions/removals, subscribe to storeChanges$ separately.
export const groupCount$ = groupStore$.pipe(
  switchMap((store) => store.count()),
);
