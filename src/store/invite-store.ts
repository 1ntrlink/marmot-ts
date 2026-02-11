import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { KeyValueStoreBackend } from "../utils/key-value.js";

/**
 * A received gift wrap event (kind 1059) that hasn't been decrypted yet.
 */
export interface ReceivedInvite extends NostrEvent {}

/**
 * A successfully decrypted and parsed Welcome invite (kind 444).
 * Ready for the app to consume.
 */
export interface UnreadInvite {
  /** Gift wrap event ID (used as key) */
  id: string;
  /** Unwrapped Welcome rumor (kind 444) */
  welcomeRumor: Rumor;
  /** Key package event ID from rumor tags (if present) */
  keyPackageEventId?: string;
  /** Sender pubkey from rumor */
  sender: string;
  /** Group relays from rumor tags */
  groupRelays: string[];
}

/**
 * Storage backends for invite states.
 * The app provides separate key-value stores for each state.
 *
 * @example
 * ```typescript
 * const inviteStore: InviteStore = {
 *   received: createMemoryBackend<ReceivedInvite>(),
 *   unread: createMemoryBackend<UnreadInvite>(),
 *   seen: createMemoryBackend<boolean>(),
 * };
 * ```
 */
export interface InviteStore {
  /** Storage for received (undecrypted) gift wraps */
  received: KeyValueStoreBackend<ReceivedInvite>;

  /** Storage for decrypted/unread invites */
  unread: KeyValueStoreBackend<UnreadInvite>;

  /** Storage for seen event IDs (deduplication) - value is always true */
  seen: KeyValueStoreBackend<boolean>;
}
