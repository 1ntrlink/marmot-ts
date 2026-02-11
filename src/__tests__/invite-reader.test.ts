import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { InviteReader } from "../client/invite-reader.js";
import type {
  InviteStore,
  ReceivedInvite,
  UnreadInvite,
} from "../store/invite-store.js";
import type { KeyValueStoreBackend } from "../utils/key-value.js";
import { WELCOME_EVENT_KIND } from "../core/protocol.js";

/**
 * Simple in-memory backend for testing
 */
class MemoryBackend<T> implements KeyValueStoreBackend<T> {
  private map = new Map<string, T>();

  async getItem(key: string): Promise<T | null> {
    return this.map.get(key) ?? null;
  }

  async setItem(key: string, value: T): Promise<T> {
    this.map.set(key, value);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.map.keys());
  }
}

/**
 * Create a mock InviteStore with in-memory backends
 */
function createMockInviteStore(): InviteStore {
  return {
    received: new MemoryBackend<ReceivedInvite>(),
    unread: new MemoryBackend<UnreadInvite>(),
    seen: new MemoryBackend<boolean>(),
  };
}

/**
 * Create a mock gift wrap event (kind 1059)
 */
function createMockGiftWrap(id: string, recipientPubkey: string): NostrEvent {
  return {
    id,
    kind: 1059,
    pubkey: "sender-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", recipientPubkey]],
    content: "encrypted-content",
    sig: "signature",
  };
}

/**
 * Create a mock Welcome rumor (kind 444)
 */
function createMockWelcomeRumor(
  id: string,
  senderPubkey: string,
  keyPackageEventId = "test-key-package-id",
): Rumor {
  return {
    id,
    kind: WELCOME_EVENT_KIND,
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relays", "wss://relay1.test", "wss://relay2.test"],
      ["e", keyPackageEventId],
      ["encoding", "base64"],
    ],
    content: "base64-encoded-welcome-message",
  };
}

describe("InviteReader", () => {
  let inviteStore: InviteStore;
  let account: PrivateKeyAccount<any>;
  let inviteReader: InviteReader;

  beforeEach(async () => {
    inviteStore = createMockInviteStore();
    account = PrivateKeyAccount.generateNew();
    const pubkey = await account.signer.getPublicKey();

    // Mock the unlockGiftWrap to return a test rumor
    inviteReader = new InviteReader({
      signer: account.signer,
      store: inviteStore,
    });
  });

  describe("ingestEvent", () => {
    it("should ingest a new gift wrap event", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap = createMockGiftWrap("test-id-1", pubkey);

      const isNew = await inviteReader.ingestEvent(giftWrap);

      expect(isNew).toBe(true);

      // Check it's in received state
      const received = await inviteReader.getReceived();
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe(giftWrap.id);
      expect(received[0]).toEqual(giftWrap);

      // Check it's marked as seen
      const isSeen = await inviteStore.seen.getItem(giftWrap.id);
      expect(isSeen).toBe(true);
    });

    it("should skip duplicate events", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap = createMockGiftWrap("test-id-1", pubkey);

      // Ingest first time
      const isNew1 = await inviteReader.ingestEvent(giftWrap);
      expect(isNew1).toBe(true);

      // Ingest second time (duplicate)
      const isNew2 = await inviteReader.ingestEvent(giftWrap);
      expect(isNew2).toBe(false);

      // Should only have one received event
      const received = await inviteReader.getReceived();
      expect(received).toHaveLength(1);
    });

    it("should throw on non-gift-wrap events", async () => {
      const invalidEvent = {
        id: "test",
        pubkey: "test-pubkey",
        created_at: Math.floor(Date.now() / 1000),
        kind: 1, // Regular note, not gift wrap
        tags: [],
        content: "test",
        sig: "test",
      } as NostrEvent;

      await expect(inviteReader.ingestEvent(invalidEvent)).rejects.toThrow(
        "Expected kind 1059 gift wrap",
      );
    });
  });

  describe("ingestEvents", () => {
    it("should ingest multiple events in batch", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap1 = createMockGiftWrap("test-id-1", pubkey);
      const giftWrap2 = createMockGiftWrap("test-id-2", pubkey);

      const newCount = await inviteReader.ingestEvents([giftWrap1, giftWrap2]);

      expect(newCount).toBe(2);

      const received = await inviteReader.getReceived();
      expect(received).toHaveLength(2);
    });

    it("should handle invalid events gracefully", async () => {
      const pubkey = await account.signer.getPublicKey();
      const validGiftWrap = createMockGiftWrap("test-id-1", pubkey);

      const invalidEvent = {
        id: "invalid",
        kind: 1,
        pubkey: "test",
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "invalid",
        sig: "sig",
      } as NostrEvent;

      let errorEmitted = false;
      inviteReader.on("error", (err, eventId) => {
        errorEmitted = true;
        expect(eventId).toBe("invalid");
      });

      const newCount = await inviteReader.ingestEvents([
        validGiftWrap,
        invalidEvent,
      ]);

      expect(newCount).toBe(1); // Only valid event counted
      expect(errorEmitted).toBe(true);
    });
  });

  describe("processReceived", () => {
    it("should emit error on decrypt failure", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap = createMockGiftWrap("test-id-1", pubkey);

      await inviteReader.ingestEvent(giftWrap);

      let errorEmitted = false;
      inviteReader.on("error", (err, eventId) => {
        errorEmitted = true;
        expect(eventId).toBe("test-id-1");
      });

      const unread = await inviteReader.processReceived();

      // Since we can't properly decrypt without full infrastructure, this will fail
      expect(unread).toHaveLength(0);
      expect(errorEmitted).toBe(true);

      // Should be removed from received even on failure
      const received = await inviteReader.getReceived();
      expect(received).toHaveLength(0);
    });
  });

  describe("getUnread", () => {
    it("should return empty array when no unread invites", async () => {
      const unread = await inviteReader.getUnread();
      expect(unread).toHaveLength(0);
    });
  });

  describe("getReceived", () => {
    it("should return all received invites", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap1 = createMockGiftWrap("test-id-1", pubkey);
      const giftWrap2 = createMockGiftWrap("test-id-2", pubkey);

      await inviteReader.ingestEvents([giftWrap1, giftWrap2]);

      const received = await inviteReader.getReceived();
      expect(received).toHaveLength(2);
    });
  });

  describe("markAsRead", () => {
    it("should remove invite from unread", async () => {
      // Manually add an unread invite to test markAsRead
      const unread: UnreadInvite = {
        id: "test-id-1",
        welcomeRumor: createMockWelcomeRumor("rumor-1", "sender"),
        keyPackageEventId: "kp-1",
        sender: "sender-pubkey",
        groupRelays: ["wss://relay.test"],
      };

      await inviteStore.unread.setItem(unread.id, unread);

      const unreadBefore = await inviteReader.getUnread();
      expect(unreadBefore).toHaveLength(1);

      await inviteReader.markAsRead(unread.id);

      const unreadAfter = await inviteReader.getUnread();
      expect(unreadAfter).toHaveLength(0);
    });
  });

  describe("watchUnread", () => {
    it("should yield initial unread invites", async () => {
      // Manually add an unread invite
      const unread: UnreadInvite = {
        id: "test-id-1",
        welcomeRumor: createMockWelcomeRumor("rumor-1", "sender"),
        keyPackageEventId: "kp-1",
        sender: "sender-pubkey",
        groupRelays: ["wss://relay.test"],
      };

      await inviteStore.unread.setItem(unread.id, unread);

      const generator = inviteReader.watchUnread();
      const { value } = await generator.next();

      expect(value).toHaveLength(1);
      expect(value[0].id).toBe(unread.id);
    });
  });

  describe("clear", () => {
    it("should clear received and unread stores", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap = createMockGiftWrap("test-id-1", pubkey);

      await inviteReader.ingestEvent(giftWrap);

      const receivedBefore = await inviteReader.getReceived();
      expect(receivedBefore).toHaveLength(1);

      await inviteReader.clear();

      const receivedAfter = await inviteReader.getReceived();
      const unreadAfter = await inviteReader.getUnread();

      expect(receivedAfter).toHaveLength(0);
      expect(unreadAfter).toHaveLength(0);

      // Seen store should NOT be cleared
      const isSeen = await inviteStore.seen.getItem(giftWrap.id);
      expect(isSeen).toBe(true);
    });
  });

  describe("clearSeen", () => {
    it("should clear the seen store", async () => {
      const pubkey = await account.signer.getPublicKey();
      const giftWrap = createMockGiftWrap("test-id-1", pubkey);

      await inviteReader.ingestEvent(giftWrap);

      const isSeenBefore = await inviteStore.seen.getItem(giftWrap.id);
      expect(isSeenBefore).toBe(true);

      await inviteReader.clearSeen();

      const isSeenAfter = await inviteStore.seen.getItem(giftWrap.id);
      expect(isSeenAfter).toBeNull();
    });
  });
});
