import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import {
  bytesToHex,
  Filter,
  matchFilter,
  NostrEvent,
} from "applesauce-core/helpers";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { GroupRumorHistoryBackend } from "marmot-ts/store";

const DB_VERSION = 1;
const STORE_NAME = "rumors";
const INDEX_NAME = "by_group_created_at";

interface StoredRumor {
  groupId: string;
  created_at: number;
  id: string;
  rumor: Rumor;
}

interface GroupHistoryDB extends DBSchema {
  [STORE_NAME]: {
    value: StoredRumor;
    key: [string, string];
    indexes: { [INDEX_NAME]: [string, number] };
  };
}

/**
 * IndexedDB-backed implementation of {@link MarmotGroupHistoryStoreBackend}.
 * Stores and retrieves group history (MIP-03 rumors) using the `idb` package.
 */
export class IdbRumorStore implements GroupRumorHistoryBackend {
  private name: string;
  private groupKey: string;

  private dbPromise: Promise<IDBPDatabase<GroupHistoryDB>> | null = null;
  private async getDB(): Promise<IDBPDatabase<GroupHistoryDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<GroupHistoryDB>(this.name, DB_VERSION, {
        upgrade(db) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: ["groupId", "id"],
          });
          store.createIndex(INDEX_NAME, ["groupId", "created_at"]);
        },
      });
    }
    return this.dbPromise;
  }

  constructor(name: string, groupId: Uint8Array) {
    this.name = name;
    this.groupKey = bytesToHex(groupId);
  }

  /** Load rumors from the indexeddb database based on the given filter */
  async queryRumors(filter: Filter): Promise<Rumor[]> {
    const db = await this.getDB();
    const { since, until, limit } = filter;

    let range: IDBKeyRange;
    if (since !== undefined && until !== undefined) {
      range = IDBKeyRange.bound(
        [this.groupKey, since],
        [this.groupKey, until],
        false,
        false,
      );
    } else if (since !== undefined) {
      range = IDBKeyRange.lowerBound([this.groupKey, since], false);
    } else if (until !== undefined) {
      range = IDBKeyRange.upperBound([this.groupKey, until], false);
    } else {
      range = IDBKeyRange.lowerBound([this.groupKey, 0]);
    }

    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index(INDEX_NAME);
    const cursor = await index.openCursor(range, "prev");
    const stored: StoredRumor[] = [];
    let cur = cursor;
    while (cur && (limit === undefined || stored.length < limit)) {
      stored.push(cur.value as StoredRumor);
      cur = await cur.continue();
    }

    return (
      stored
        .map((s) => s.rumor)
        // Filter down by extra nostr filters if provided
        .filter((r) => matchFilter(filter, r as NostrEvent))
    );
  }

  async addRumor(message: Rumor): Promise<void> {
    const db = await this.getDB();
    const entry: StoredRumor = {
      groupId: this.groupKey,
      created_at: message.created_at,
      id: message.id,
      rumor: message,
    };
    await db.put(STORE_NAME, entry);
  }
}
