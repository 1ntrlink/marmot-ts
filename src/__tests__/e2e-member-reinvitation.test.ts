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
import { getGroupMembers, getPubkeyLeafNodeIndexes } from "../core/group-members";
import { Proposals } from "../client/group/index";
import type { MarmotGroup } from "../client/marmot-group";

// ============================================================================
// Helpers (same patterns as e2e-member-removal.test.ts)
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

// ============================================================================
// Test
// ============================================================================

describe("End-to-end: member reinvitation after removal", () => {
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

  it("removed member can be re-invited and rejoin the group", { timeout: 30_000 }, async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();
    const memberBPubkey = await memberBAccount.signer.getPublicKey();

    // -----------------------------------------------------------------------
    // 1. Setup: Creator creates group, invites A and B, all exchange messages
    // -----------------------------------------------------------------------
    const creatorGroup = await creatorClient.createGroup(
      "Reinvitation Test",
      {
        adminPubkeys: [creatorPubkey],
        relays: ["wss://mock-relay.test"],
      },
    );

    const marmotGroupData = extractMarmotGroupData(creatorGroup.state);
    if (!marmotGroupData)
      throw new Error("Marmot Group Data extension not found");
    const nostrGroupIdHex = bytesToHex(marmotGroupData.nostrGroupId);

    // Invite Member A
    const memberAKeyPkgEvent1 = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);
    const memberAGroup = await joinFromWelcome(
      memberAClient,
      memberAAccount,
      memberAKeyPkgEvent1,
      mockNetwork,
    );
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);

    // Record A's leaf index before removal
    const memberALeafIndexesBefore = getPubkeyLeafNodeIndexes(
      creatorGroup.state,
      memberAPubkey,
    );
    expect(memberALeafIndexesBefore.length).toBe(1);
    const memberALeafIndexBefore = memberALeafIndexesBefore[0];

    // Invite Member B
    const memberBKeyPkgEvent = await publishKeyPackage(
      memberBClient,
      memberBAccount,
      ciphersuite,
      mockNetwork,
    );
    await inviteMember(creatorGroup, memberBPubkey, mockNetwork);
    await catchUpOnGroupEvents(memberAGroup, nostrGroupIdHex, mockNetwork);
    const memberBGroup = await joinFromWelcome(
      memberBClient,
      memberBAccount,
      memberBKeyPkgEvent,
      mockNetwork,
    );
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);

    // Verify all 3 members at same epoch
    expect(memberAGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );
    expect(getGroupMembers(creatorGroup.state).length).toBe(3);

    // All 3 exchange messages
    await sendMessage(creatorGroup, creatorPubkey, "Setup message");
    const aSetup = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    const bSetup = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(aSetup.some((m) => m.content === "Setup message")).toBe(true);
    expect(bSetup.some((m) => m.content === "Setup message")).toBe(true);

    // -----------------------------------------------------------------------
    // 2. Creator removes Member A, then sends empty commit for key rotation
    // -----------------------------------------------------------------------
    await creatorGroup.commit({
      extraProposals: [Proposals.proposeRemoveUser(memberAPubkey) as any],
    });

    const membersAfterRemoval = getGroupMembers(creatorGroup.state);
    expect(membersAfterRemoval.length).toBe(2);
    expect(membersAfterRemoval).toContain(creatorPubkey);
    expect(membersAfterRemoval).toContain(memberBPubkey);
    expect(membersAfterRemoval).not.toContain(memberAPubkey);

    // B ingests the removal commit
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // Empty commit to force path update (key rotation)
    await creatorGroup.commit();
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // -----------------------------------------------------------------------
    // 3. Creator sends message → A CANNOT decrypt, B CAN decrypt
    // -----------------------------------------------------------------------
    await sendMessage(
      creatorGroup,
      creatorPubkey,
      "Secret after removal",
    );

    const bPostRemoval = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(
      bPostRemoval.some((m) => m.content === "Secret after removal"),
    ).toBe(true);

    const aPostRemoval = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(
      aPostRemoval.some((m) => m.content === "Secret after removal"),
    ).toBe(false);

    // -----------------------------------------------------------------------
    // 4. Member A generates a NEW KeyPackage (fresh credential + key material)
    // -----------------------------------------------------------------------
    const memberAKeyPkgEvent2 = await publishKeyPackage(
      memberAClient,
      memberAAccount,
      ciphersuite,
      mockNetwork,
    );

    // -----------------------------------------------------------------------
    // 5. Creator invites A back using the new KeyPackage → A joins via Welcome
    // -----------------------------------------------------------------------
    await inviteMember(creatorGroup, memberAPubkey, mockNetwork);

    // B ingests the re-invitation commit
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);

    // A joins from the new Welcome
    const memberAGroup2 = await joinFromWelcome(
      memberAClient,
      memberAAccount,
      memberAKeyPkgEvent2,
      mockNetwork,
    );
    await catchUpOnGroupEvents(memberAGroup2, nostrGroupIdHex, mockNetwork);

    // Verify 3 members again
    expect(getGroupMembers(creatorGroup.state).length).toBe(3);

    // Verify A is back in the tree with a leaf node. MLS reuses blank leaf
    // slots, so the index may be the same as before removal — the important
    // thing is that A has a completely new leaf node with fresh key material.
    const memberALeafIndexesAfter = getPubkeyLeafNodeIndexes(
      creatorGroup.state,
      memberAPubkey,
    );
    expect(memberALeafIndexesAfter.length).toBe(1);

    // -----------------------------------------------------------------------
    // 6. Creator sends message → BOTH A and B decrypt it
    // -----------------------------------------------------------------------
    await sendMessage(
      creatorGroup,
      creatorPubkey,
      "Welcome back A!",
    );

    const aAfterRejoin = await catchUpOnGroupEvents(
      memberAGroup2,
      nostrGroupIdHex,
      mockNetwork,
    );
    const bAfterRejoin = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(aAfterRejoin.some((m) => m.content === "Welcome back A!")).toBe(
      true,
    );
    expect(bAfterRejoin.some((m) => m.content === "Welcome back A!")).toBe(
      true,
    );

    // -----------------------------------------------------------------------
    // 7. Member A sends message → Creator and B both decrypt it
    // -----------------------------------------------------------------------
    await sendMessage(memberAGroup2, memberAPubkey, "Hello again from A!");

    const creatorMsgs = await catchUpOnGroupEvents(
      creatorGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    const bMsgs = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );

    expect(
      creatorMsgs.some((m) => m.content === "Hello again from A!"),
    ).toBe(true);
    expect(creatorMsgs.find((m) => m.content === "Hello again from A!")!.pubkey).toBe(
      memberAPubkey,
    );
    expect(bMsgs.some((m) => m.content === "Hello again from A!")).toBe(true);
    expect(bMsgs.find((m) => m.content === "Hello again from A!")!.pubkey).toBe(
      memberAPubkey,
    );

    // -----------------------------------------------------------------------
    // 8. Verify A's epoch matches Creator's and B's epoch after re-join
    // -----------------------------------------------------------------------
    expect(memberAGroup2.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );
  });
});
