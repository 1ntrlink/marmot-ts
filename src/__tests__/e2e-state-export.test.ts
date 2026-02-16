import { bytesToHex } from "@noble/hashes/utils.js";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { Rumor, unlockGiftWrap } from "applesauce-common/helpers/gift-wrap";
import { getEventHash, type NostrEvent } from "nostr-tools";
import {
  CiphersuiteImpl,
  defaultCryptoProvider,
  getCiphersuiteImpl,
} from "ts-mls";
import { beforeEach, describe, expect, it } from "vitest";

import { MarmotClient } from "../client/marmot-client";
import {
  extractMarmotGroupData,
  serializeClientState,
  deserializeClientState,
  getMemberCount,
  getEpoch,
} from "../core/client-state";
import { createCredential } from "../core/credential";
import { generateKeyPackage } from "../core/key-package";
import { createKeyPackageEvent } from "../core/key-package-event";
import {
  GROUP_EVENT_KIND,
  KEY_PACKAGE_KIND,
  WELCOME_EVENT_KIND,
} from "../core/protocol";
import { KeyPackageStore } from "../store/key-package-store";
import { KeyValueGroupStateBackend } from "../store/adapters/key-value-group-state-backend";
import { unixNow } from "../utils/nostr";
import { MockNetwork } from "./helpers/mock-network";
import { MemoryBackend } from "./ingest-commit-race.test";
import { deserializeApplicationData } from "../core/group-message";
import { EncryptedKeyValueStore } from "../extra/encrypted-key-value-store";
import type { MarmotGroup } from "../client/marmot-group";

// ============================================================================
// Helpers
// ============================================================================

function createClient(
  network: MockNetwork,
  account: PrivateKeyAccount<any>,
  groupStateBackend?: KeyValueGroupStateBackend,
): MarmotClient {
  return new MarmotClient({
    groupStateBackend:
      groupStateBackend ?? new KeyValueGroupStateBackend(new MemoryBackend()),
    keyPackageStore: new KeyPackageStore(new MemoryBackend()),
    signer: account.signer,
    network,
  });
}

async function publishKeyPackage(
  client: MarmotClient,
  account: PrivateKeyAccount<any>,
  ciphersuite: CiphersuiteImpl,
  network: MockNetwork,
): Promise<NostrEvent> {
  const pubkey = await account.signer.getPublicKey();
  const credential = createCredential(pubkey);
  const keyPackage = await generateKeyPackage({
    credential,
    ciphersuiteImpl: ciphersuite,
  });

  await client.keyPackageStore.add(keyPackage);

  const unsigned = createKeyPackageEvent({
    keyPackage: keyPackage.publicPackage,
    relays: ["wss://mock-relay.test"],
  });

  const signed: NostrEvent = await account.signer.signEvent(unsigned);
  await network.publish(["wss://mock-relay.test"], signed);
  return signed;
}

async function inviteMember(
  adminGroup: MarmotGroup,
  memberPubkey: string,
  network: MockNetwork,
): Promise<void> {
  const keyPackageEvents = await network.request(["wss://mock-relay.test"], {
    kinds: [KEY_PACKAGE_KIND],
    authors: [memberPubkey],
  });
  expect(keyPackageEvents.length).toBeGreaterThanOrEqual(1);
  await adminGroup.inviteByKeyPackageEvent(
    keyPackageEvents[keyPackageEvents.length - 1],
  );
}

async function joinFromWelcome(
  client: MarmotClient,
  account: PrivateKeyAccount<any>,
  signedKeyPackageEvent: NostrEvent,
  network: MockNetwork,
): Promise<MarmotGroup> {
  const pubkey = await account.signer.getPublicKey();

  const giftWraps = await network.request(["wss://mock-inbox.test"], {
    kinds: [1059],
    "#p": [pubkey],
  });
  expect(giftWraps.length).toBeGreaterThanOrEqual(1);

  const latestGiftWrap = giftWraps[giftWraps.length - 1];
  const welcomeRumor = await unlockGiftWrap(latestGiftWrap, account.signer);
  expect(welcomeRumor.kind).toBe(WELCOME_EVENT_KIND);

  const keyPackageEventId = welcomeRumor.tags.find((t) => t[0] === "e")?.[1];
  expect(keyPackageEventId).toBe(signedKeyPackageEvent.id);

  return client.joinGroupFromWelcome({ welcomeRumor, keyPackageEventId });
}

async function catchUpOnGroupEvents(
  group: MarmotGroup,
  nostrGroupIdHex: string,
  network: MockNetwork,
): Promise<Rumor[]> {
  const groupEvents = await network.request(["wss://mock-relay.test"], {
    kinds: [GROUP_EVENT_KIND],
    "#h": [nostrGroupIdHex],
  });

  const messages: Rumor[] = [];
  for await (const result of group.ingest(groupEvents)) {
    if (result.kind === "applicationMessage") {
      messages.push(deserializeApplicationData(result.message));
    }
  }
  return messages;
}

async function sendMessage(
  group: MarmotGroup,
  pubkey: string,
  content: string,
): Promise<void> {
  const rumor: Rumor = {
    id: "",
    kind: 9,
    pubkey,
    created_at: unixNow(),
    content,
    tags: [],
  };
  rumor.id = getEventHash(rumor);
  await group.sendApplicationRumor(rumor);
}

// ============================================================================
// Tests
// ============================================================================

describe("End-to-end: state export / import", () => {
  let creatorAccount: PrivateKeyAccount<any>;
  let memberAAccount: PrivateKeyAccount<any>;
  let ciphersuite: CiphersuiteImpl;
  let mockNetwork: MockNetwork;
  let creatorClient: MarmotClient;
  let memberAClient: MarmotClient;

  beforeEach(async () => {
    creatorAccount = PrivateKeyAccount.generateNew();
    memberAAccount = PrivateKeyAccount.generateNew();

    ciphersuite = await getCiphersuiteImpl(
      "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      defaultCryptoProvider,
    );

    mockNetwork = new MockNetwork();

    creatorClient = createClient(mockNetwork, creatorAccount);
    memberAClient = createClient(mockNetwork, memberAAccount);
  });

  // -------------------------------------------------------------------------
  // 1. State round-trip
  // -------------------------------------------------------------------------
  it("state round-trip: serialize → deserialize → verify epoch, groupId, member count match", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();

    // Create group and invite Member A
    const creatorGroup = await creatorClient.createGroup("Round-Trip Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const memberAKeyPkgEvent = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);
    const memberAGroup = await joinFromWelcome(
      memberAClient,
      memberAAccount,
      memberAKeyPkgEvent,
      mockNetwork,
    );
    await catchUpOnGroupEvents(
      memberAGroup,
      bytesToHex(extractMarmotGroupData(creatorGroup.state)!.nostrGroupId),
      mockNetwork,
    );

    // Send a message so the state has some history
    await sendMessage(creatorGroup, creatorPubkey, "Before export");

    // Record original state properties
    const originalEpoch = getEpoch(creatorGroup.state);
    const originalGroupId = bytesToHex(creatorGroup.state.groupContext.groupId);
    const originalMemberCount = getMemberCount(creatorGroup.state);

    // Serialize → bytes → deserialize
    const serialized = serializeClientState(creatorGroup.state);
    expect(serialized).toBeInstanceOf(Uint8Array);
    expect(serialized.length).toBeGreaterThan(0);

    const deserialized = deserializeClientState(serialized);

    // Verify all properties match
    expect(getEpoch(deserialized)).toBe(originalEpoch);
    expect(bytesToHex(deserialized.groupContext.groupId)).toBe(originalGroupId);
    expect(getMemberCount(deserialized)).toBe(originalMemberCount);

    // MarmotGroupData also survives the round-trip
    const originalMarmotData = extractMarmotGroupData(creatorGroup.state)!;
    const restoredMarmotData = extractMarmotGroupData(deserialized)!;
    expect(restoredMarmotData).not.toBeNull();
    expect(bytesToHex(restoredMarmotData.nostrGroupId)).toBe(
      bytesToHex(originalMarmotData.nostrGroupId),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Cross-backend restore
  // -------------------------------------------------------------------------
  it("cross-backend restore: serialize state → restore to fresh backend → load group → decrypt new message", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();

    // Create group and invite Member A
    const creatorGroup = await creatorClient.createGroup("Cross-Backend Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const marmotGroupData = extractMarmotGroupData(creatorGroup.state)!;
    const nostrGroupIdHex = bytesToHex(marmotGroupData.nostrGroupId);

    const memberAKeyPkgEvent = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);
    const memberAGroup = await joinFromWelcome(
      memberAClient,
      memberAAccount,
      memberAKeyPkgEvent,
      mockNetwork,
    );
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);

    // Serialize Member A's state
    const serialized = serializeClientState(memberAGroup.state);
    const groupId = memberAGroup.state.groupContext.groupId;

    // Create a fresh backend and restore the state
    const freshBackend = new KeyValueGroupStateBackend(new MemoryBackend());
    await freshBackend.set(groupId, serialized);

    // Create a new client with the fresh backend
    const restoredClient = createClient(
      mockNetwork,
      memberAAccount,
      freshBackend,
    );

    // Load all groups from the new backend
    const loadedGroups = await restoredClient.loadAllGroups();
    expect(loadedGroups.length).toBe(1);

    const restoredGroup = loadedGroups[0];
    expect(bytesToHex(restoredGroup.id)).toBe(bytesToHex(groupId));

    // Creator sends a new message after the restore
    await sendMessage(creatorGroup, creatorPubkey, "After restore");

    // Restored group should be able to decrypt it
    const msgs = await catchUpOnGroupEvents(
      restoredGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(msgs.some((m) => m.content === "After restore")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Multi-group export
  // -------------------------------------------------------------------------
  it("multi-group export: create 2 groups → serialize both → restore to fresh backend → load and verify both accessible", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();

    // Create two separate groups
    const group1 = await creatorClient.createGroup("Group Alpha", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });
    const group2 = await creatorClient.createGroup("Group Beta", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const group1Id = group1.state.groupContext.groupId;
    const group2Id = group2.state.groupContext.groupId;

    // Group IDs should be different
    expect(bytesToHex(group1Id)).not.toBe(bytesToHex(group2Id));

    // Serialize both
    const serialized1 = serializeClientState(group1.state);
    const serialized2 = serializeClientState(group2.state);

    // Restore to a fresh backend
    const freshBackend = new KeyValueGroupStateBackend(new MemoryBackend());
    await freshBackend.set(group1Id, serialized1);
    await freshBackend.set(group2Id, serialized2);

    // Create a new client with the fresh backend
    const restoredClient = createClient(
      mockNetwork,
      creatorAccount,
      freshBackend,
    );

    // Load all groups
    const loadedGroups = await restoredClient.loadAllGroups();
    expect(loadedGroups.length).toBe(2);

    // Verify both groups are present
    const loadedIds = loadedGroups.map((g) => bytesToHex(g.id)).sort();
    const expectedIds = [bytesToHex(group1Id), bytesToHex(group2Id)].sort();
    expect(loadedIds).toEqual(expectedIds);

    // Each has correct epoch (1 member = creator only, epoch 0)
    for (const g of loadedGroups) {
      expect(getEpoch(g.state)).toBe(getEpoch(group1.state)); // both should be epoch 0
      expect(getMemberCount(g.state)).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Corrupted state rejected
  // -------------------------------------------------------------------------
  it("corrupted state rejected: random bytes → deserializeClientState() throws clean error", async () => {
    // Feed random bytes
    const randomBytes = new Uint8Array(128);
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }

    expect(() => deserializeClientState(randomBytes)).toThrow(
      /Failed to deserialize ClientState/,
    );

    // Empty bytes
    expect(() => deserializeClientState(new Uint8Array(0))).toThrow();

    // Single byte
    expect(() => deserializeClientState(new Uint8Array([0x42]))).toThrow();
  });

  // -------------------------------------------------------------------------
  // 5. Empty backend restore
  // -------------------------------------------------------------------------
  it("empty backend restore: loadAllGroups() on empty backend → returns empty array, no crash", async () => {
    const emptyBackend = new KeyValueGroupStateBackend(new MemoryBackend());
    const emptyClient = createClient(
      mockNetwork,
      creatorAccount,
      emptyBackend,
    );

    const groups = await emptyClient.loadAllGroups();
    expect(groups).toEqual([]);
    expect(groups.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. State with KeyPackages
  // -------------------------------------------------------------------------
  it("state with KeyPackages: generate 2 KPs → store → export via list() → restore to new store → verify both retrievable", async () => {
    const pubkey = await creatorAccount.signer.getPublicKey();
    const credential = createCredential(pubkey);

    // Generate and store 2 key packages
    const store1 = new KeyPackageStore(new MemoryBackend());

    const kp1 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });
    const kp2 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    await store1.add(kp1);
    await store1.add(kp2);

    // Export via list()
    const listed = await store1.list();
    expect(listed.length).toBe(2);

    // Create a new store and restore from the exported data
    const store2 = new KeyPackageStore(new MemoryBackend());

    for (const item of listed) {
      // Retrieve the full key package (including private key) from the original store
      const fullKp = await store1.getKeyPackage(item.publicPackage);
      expect(fullKp).not.toBeNull();

      // Add to the new store
      await store2.add({
        publicPackage: fullKp!.publicPackage,
        privatePackage: fullKp!.privatePackage,
      });
    }

    // Verify both are present in the new store
    const restored = await store2.list();
    expect(restored.length).toBe(2);

    // Each key package ref should be retrievable
    expect(await store2.has(kp1.publicPackage)).toBe(true);
    expect(await store2.has(kp2.publicPackage)).toBe(true);

    // Private keys should also be retrievable
    expect(await store2.getPrivateKey(kp1.publicPackage)).not.toBeNull();
    expect(await store2.getPrivateKey(kp2.publicPackage)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. Encrypted round-trip
  // -------------------------------------------------------------------------
  it("encrypted round-trip: EncryptedKeyValueStore wraps MemoryBackend → store and retrieve group state", async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();

    // Create a group so we have real state bytes
    const group = await creatorClient.createGroup("Encrypted Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const stateBytes = serializeClientState(group.state);
    const groupIdHex = bytesToHex(group.state.groupContext.groupId);

    // Set up EncryptedKeyValueStore wrapping a MemoryBackend
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const innerBackend = new MemoryBackend<Uint8Array>();
    const encStore = new EncryptedKeyValueStore(innerBackend, salt);

    // Unlock with a password
    const unlocked = await encStore.unlock("test-password-123");
    expect(unlocked).toBe(true);
    expect(encStore.unlocked).toBe(true);

    // Store the state bytes
    await encStore.setItem(groupIdHex, stateBytes);

    // Verify the raw data in innerBackend is encrypted (not equal to original)
    const rawStored = await innerBackend.getItem(groupIdHex);
    expect(rawStored).not.toBeNull();
    // Encrypted data includes 16-byte IV prefix, so it's longer
    expect(rawStored!.length).toBeGreaterThan(stateBytes.length);
    // The raw stored data should NOT be byte-equal to the original
    expect(bytesToHex(rawStored!)).not.toBe(bytesToHex(stateBytes));

    // Retrieve and decrypt via the encrypted store
    const retrieved = await encStore.getItem(groupIdHex);
    expect(retrieved).not.toBeNull();

    // Decrypted data should match original
    expect(bytesToHex(retrieved!)).toBe(bytesToHex(stateBytes));

    // Deserialize the decrypted bytes to verify they produce valid state
    const restoredState = deserializeClientState(retrieved!);
    expect(getEpoch(restoredState)).toBe(getEpoch(group.state));
    expect(bytesToHex(restoredState.groupContext.groupId)).toBe(
      bytesToHex(group.state.groupContext.groupId),
    );
    expect(getMemberCount(restoredState)).toBe(getMemberCount(group.state));

    // Wrong password should fail
    const encStore2 = new EncryptedKeyValueStore(innerBackend, salt);
    const unlocked2 = await encStore2.unlock("wrong-password");
    expect(unlocked2).toBe(false);
  });
});
