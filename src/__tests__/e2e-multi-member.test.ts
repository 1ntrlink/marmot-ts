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
import type { MarmotGroup } from "../client/marmot-group";

// ============================================================================
// Helpers
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

  // Use the latest gift wrap for this member
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
// Test
// ============================================================================

describe("End-to-end: multi-member group", () => {
  let creatorAccount: PrivateKeyAccount<any>;
  let memberAAccount: PrivateKeyAccount<any>;
  let memberBAccount: PrivateKeyAccount<any>;
  let ciphersuite: CiphersuiteImpl;
  let mockNetwork: MockNetwork;
  let creatorClient: MarmotClient;
  let memberAClient: MarmotClient;
  let memberBClient: MarmotClient;

  beforeEach(async () => {
    creatorAccount = PrivateKeyAccount.generateNew();
    memberAAccount = PrivateKeyAccount.generateNew();
    memberBAccount = PrivateKeyAccount.generateNew();

    ciphersuite = await getCiphersuiteImpl(
      "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      defaultCryptoProvider,
    );

    mockNetwork = new MockNetwork();

    creatorClient = createClient(mockNetwork, creatorAccount);
    memberAClient = createClient(mockNetwork, memberAAccount);
    memberBClient = createClient(mockNetwork, memberBAccount);
  });

  it("three members exchange messages after sequential invites", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();
    const memberBPubkey = await memberBAccount.signer.getPublicKey();

    // -----------------------------------------------------------------------
    // 1. Creator creates a group
    // -----------------------------------------------------------------------
    const creatorGroup = await creatorClient.createGroup("Multi-Member Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const marmotGroupData = extractMarmotGroupData(creatorGroup.state);
    if (!marmotGroupData) throw new Error("Marmot Group Data extension not found");
    const nostrGroupIdHex = bytesToHex(marmotGroupData.nostrGroupId);

    // -----------------------------------------------------------------------
    // 2. Creator invites Member A → A joins → A decrypts a message from Creator
    // -----------------------------------------------------------------------

    // Member A publishes key package
    const memberAKeyPkgEvent = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );

    // Creator invites Member A
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);

    // Member A joins from Welcome
    const memberAGroup = await joinFromWelcome(
      memberAClient,
      memberAAccount,
      memberAKeyPkgEvent,
      mockNetwork,
    );

    // Member A catches up on group events (should be no-op, already at epoch)
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);

    // Verify epochs match
    expect(memberAGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // Creator sends a message, Member A decrypts it
    await sendMessage(creatorGroup, creatorPubkey, "Hello Member A!");
    const memberAMessages1 = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(memberAMessages1.length).toBe(1);
    expect(memberAMessages1[0].content).toBe("Hello Member A!");
    expect(memberAMessages1[0].pubkey).toBe(creatorPubkey);

    // -----------------------------------------------------------------------
    // 3. Creator invites Member B → B joins → B decrypts a message from Creator
    // -----------------------------------------------------------------------

    // Member B publishes key package
    const memberBKeyPkgEvent = await publishKeyPackage(
      memberBClient,
      memberBAccount,
      ciphersuite,
      mockNetwork,
    );

    // Creator invites Member B
    await inviteMember(creatorGroup, memberBPubkey, mockNetwork);

    // Member A must ingest the commit for B's invite to stay in sync
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);

    // Member B joins from Welcome
    const memberBGroup = await joinFromWelcome(
      memberBClient,
      memberBAccount,
      memberBKeyPkgEvent,
      mockNetwork,
    );

    // Member B catches up on group events
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);

    // All three should be at the same epoch
    expect(memberAGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // Creator sends a message that B should decrypt
    await sendMessage(creatorGroup, creatorPubkey, "Welcome Member B!");
    const memberBMessages1 = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(memberBMessages1.length).toBe(1);
    expect(memberBMessages1[0].content).toBe("Welcome Member B!");
    expect(memberBMessages1[0].pubkey).toBe(creatorPubkey);

    // -----------------------------------------------------------------------
    // 4. Creator sends a new message → BOTH A and B decrypt it
    // -----------------------------------------------------------------------

    // Member A must also catch up (ingest B's welcome commit + Creator's msg to B)
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);

    await sendMessage(creatorGroup, creatorPubkey, "Broadcast to everyone!");

    const memberAMessages2 = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    const memberBMessages2 = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );

    // Both A and B should receive the broadcast
    expect(memberAMessages2.some((m) => m.content === "Broadcast to everyone!")).toBe(true);
    expect(memberBMessages2.some((m) => m.content === "Broadcast to everyone!")).toBe(true);

    // -----------------------------------------------------------------------
    // 5. Member A sends a message → Creator AND Member B both decrypt it
    // -----------------------------------------------------------------------
    await sendMessage(memberAGroup, memberAPubkey, "Hello from A!");

    const creatorMessages = await catchUpOnGroupEvents(
      creatorGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    const memberBMessages3 = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );

    const creatorReceivedFromA = creatorMessages.find(
      (m) => m.content === "Hello from A!",
    );
    const memberBReceivedFromA = memberBMessages3.find(
      (m) => m.content === "Hello from A!",
    );

    expect(creatorReceivedFromA).toBeDefined();
    expect(creatorReceivedFromA!.pubkey).toBe(memberAPubkey);
    expect(memberBReceivedFromA).toBeDefined();
    expect(memberBReceivedFromA!.pubkey).toBe(memberAPubkey);
  });
});
