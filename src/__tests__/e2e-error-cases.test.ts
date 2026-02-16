import { bytesToHex } from "@noble/hashes/utils.js";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { Rumor, unlockGiftWrap } from "applesauce-common/helpers/gift-wrap";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  type NostrEvent,
} from "nostr-tools";
import {
  CiphersuiteImpl,
  defaultCryptoProvider,
  getCiphersuiteImpl,
} from "ts-mls";
import { beforeEach, describe, expect, it } from "vitest";

import { MarmotClient } from "../client/marmot-client";
import { extractMarmotGroupData } from "../core/client-state";
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
import { getGroupMembers } from "../core/group-members";
import { InviteReader } from "../client/invite-reader";
import type { InviteStore } from "../store/invite-store";
import type { MarmotGroup } from "../client/marmot-group";

// ============================================================================
// Helpers (same patterns as e2e-multi-member.test.ts)
// ============================================================================

function createClient(
  network: MockNetwork,
  account: PrivateKeyAccount<any>,
): MarmotClient {
  return new MarmotClient({
    groupStateBackend: new KeyValueGroupStateBackend(new MemoryBackend()),
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

function createInviteStore(): InviteStore {
  return {
    received: new MemoryBackend(),
    unread: new MemoryBackend(),
    seen: new MemoryBackend(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("End-to-end: error cases", () => {
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
  // 1. Bad pubkey invitation
  // -------------------------------------------------------------------------
  it("bad pubkey invitation: no KeyPackage published", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();

    // Creator creates a group
    const creatorGroup = await creatorClient.createGroup("Error Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const epochBefore = creatorGroup.state.groupContext.epoch;
    const membersBefore = getGroupMembers(creatorGroup.state);

    // Try to fetch KeyPackage for a pubkey that never published one
    const unknownPubkey =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const keyPackageEvents = await mockNetwork.request(
      ["wss://mock-relay.test"],
      {
        kinds: [KEY_PACKAGE_KIND],
        authors: [unknownPubkey],
      },
    );

    // No KeyPackage found — graceful failure at the application layer
    expect(keyPackageEvents.length).toBe(0);

    // Verify group state is unchanged
    expect(creatorGroup.state.groupContext.epoch).toBe(epochBefore);
    expect(getGroupMembers(creatorGroup.state)).toEqual(membersBefore);

    // Existing members still work — invite a real member and exchange a message
    const memberAKeyPkgEvent = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, await memberAAccount.signer.getPublicKey(), mockNetwork);
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

    await sendMessage(creatorGroup, creatorPubkey, "Still works!");
    const msgs = await catchUpOnGroupEvents(
      memberAGroup,
      bytesToHex(extractMarmotGroupData(creatorGroup.state)!.nostrGroupId),
      mockNetwork,
    );
    expect(msgs.some((m) => m.content === "Still works!")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Corrupted KeyPackage
  // -------------------------------------------------------------------------
  it("corrupted KeyPackage: garbage content does not crash", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();

    const creatorGroup = await creatorClient.createGroup("Corrupt KP Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const epochBefore = creatorGroup.state.groupContext.epoch;
    const membersBefore = getGroupMembers(creatorGroup.state);

    // Craft a kind 443 event with garbage base64 content
    const fakeKeyPackageEvent: NostrEvent = {
      id: "deadbeef00000000000000000000000000000000000000000000000000000001",
      pubkey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      created_at: unixNow(),
      kind: KEY_PACKAGE_KIND,
      content: "dGhpcyBpcyBub3QgYSB2YWxpZCBrZXkgcGFja2FnZQ==", // "this is not a valid key package" in base64
      tags: [
        ["mls_protocol_version", "1.0"],
        ["mls_ciphersuite", "0x0001"],
        ["encoding", "base64"],
      ],
      sig: "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    };

    // inviteByKeyPackageEvent should throw when trying to parse garbage content
    await expect(
      creatorGroup.inviteByKeyPackageEvent(fakeKeyPackageEvent),
    ).rejects.toThrow();

    // Group state unchanged
    expect(creatorGroup.state.groupContext.epoch).toBe(epochBefore);
    expect(getGroupMembers(creatorGroup.state)).toEqual(membersBefore);
  });

  // -------------------------------------------------------------------------
  // 3. Corrupted group state
  // -------------------------------------------------------------------------
  it("corrupted group state: loadAllGroups() skips bad entries", async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();

    // Create a real group so we have one valid entry
    const creatorGroup = await creatorClient.createGroup("Good Group", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });
    await creatorGroup.save();

    // Manually inject corrupted bytes into the group state store
    const corruptedGroupId = new Uint8Array(32);
    corruptedGroupId[0] = 0xff;
    corruptedGroupId[1] = 0xee;

    // Flip bits in random data to simulate corrupted serialization
    const corruptedBytes = new Uint8Array(128);
    for (let i = 0; i < corruptedBytes.length; i++) {
      corruptedBytes[i] = Math.floor(Math.random() * 256);
    }

    await creatorClient.groupStateStore.set(corruptedGroupId, corruptedBytes);

    // loadAllGroups() should skip the corrupted group, not crash
    const groups = await creatorClient.loadAllGroups();

    // The valid group should still load
    expect(groups.length).toBe(1);
    expect(bytesToHex(groups[0].id)).toBe(bytesToHex(creatorGroup.id));
  });

  // -------------------------------------------------------------------------
  // 4. Message from non-member
  // -------------------------------------------------------------------------
  it("message from non-member: decryption fails, no state corruption", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();

    // Create group and invite Member A
    const creatorGroup = await creatorClient.createGroup("Non-Member Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const marmotGroupData = extractMarmotGroupData(creatorGroup.state);
    if (!marmotGroupData)
      throw new Error("Marmot Group Data extension not found");
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

    // Record state before injecting the fake event
    const epochBefore = creatorGroup.state.groupContext.epoch;
    const membersBefore = getGroupMembers(creatorGroup.state);

    // Craft a fake kind 445 event from a non-member with random content.
    // A non-member does not have the exporter secret, so the NIP-44
    // decryption layer will fail (wrong conversation key).
    const ephemeralKey = generateSecretKey();
    const fakeGroupEvent = finalizeEvent(
      {
        kind: GROUP_EVENT_KIND,
        created_at: unixNow(),
        content: "this-is-garbage-content-not-nip44-encrypted",
        tags: [["h", nostrGroupIdHex]],
      },
      ephemeralKey,
    );

    // Push the fake event into the mock network
    await mockNetwork.publish(["wss://mock-relay.test"], fakeGroupEvent);

    // Creator ingests all group events (including the fake one).
    // ingest() catches decryption failures and puts them in "unreadable" —
    // it should NOT throw or corrupt state.
    const creatorMsgs = await catchUpOnGroupEvents(
      creatorGroup,
      nostrGroupIdHex,
      mockNetwork,
    );

    // No application messages from the fake event
    expect(
      creatorMsgs.some((m) => m.content === "this-is-garbage-content-not-nip44-encrypted"),
    ).toBe(false);

    // Group state is not corrupted
    expect(creatorGroup.state.groupContext.epoch).toBe(epochBefore);
    expect(getGroupMembers(creatorGroup.state)).toEqual(membersBefore);

    // Group continues working: Creator sends, A decrypts
    await sendMessage(creatorGroup, creatorPubkey, "After fake event");
    const aMsgs = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(aMsgs.some((m) => m.content === "After fake event")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Duplicate Welcome
  // -------------------------------------------------------------------------
  it("duplicate Welcome: second gift-wrap is deduplicated", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();

    // Create group
    const creatorGroup = await creatorClient.createGroup("Dedup Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    // Member A publishes key package and gets invited
    const memberAKeyPkgEvent = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);

    // Fetch the Welcome gift-wrap from the network
    const giftWraps = await mockNetwork.request(["wss://mock-inbox.test"], {
      kinds: [1059],
      "#p": [memberAPubkey],
    });
    expect(giftWraps.length).toBeGreaterThanOrEqual(1);
    const welcomeGiftWrap = giftWraps[giftWraps.length - 1];

    // Create an InviteReader with an in-memory store
    const inviteStore = createInviteStore();
    const inviteReader = new InviteReader({
      signer: memberAAccount.signer,
      store: inviteStore,
    });

    // First ingest: should return true (new event)
    const firstResult = await inviteReader.ingestEvent(welcomeGiftWrap);
    expect(firstResult).toBe(true);

    // Second ingest of the SAME event: should return false (already seen)
    const secondResult = await inviteReader.ingestEvent(welcomeGiftWrap);
    expect(secondResult).toBe(false);

    // Verify seen store has the event
    const isSeen = await inviteStore.seen.getItem(welcomeGiftWrap.id);
    expect(isSeen).toBe(true);

    // Verify only one received entry exists
    const receivedKeys = await inviteStore.received.keys();
    expect(receivedKeys.length).toBe(1);
  });
});
