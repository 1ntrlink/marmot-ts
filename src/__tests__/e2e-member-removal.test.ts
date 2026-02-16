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
import { getGroupMembers } from "../core/group-members";
import { Proposals } from "../client/group/index";
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

// ============================================================================
// Test
// ============================================================================

describe("End-to-end: member removal", () => {
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

  it("removed member cannot decrypt new messages", async () => {
    const creatorPubkey = await creatorAccount.signer.getPublicKey();
    const memberAPubkey = await memberAAccount.signer.getPublicKey();
    const memberBPubkey = await memberBAccount.signer.getPublicKey();

    // -----------------------------------------------------------------------
    // 1. Setup: Creator creates group, invites A and B, all exchange messages
    // -----------------------------------------------------------------------
    const creatorGroup = await creatorClient.createGroup("Removal Test", {
      adminPubkeys: [creatorPubkey],
      relays: ["wss://mock-relay.test"],
    });

    const marmotGroupData = extractMarmotGroupData(creatorGroup.state);
    if (!marmotGroupData)
      throw new Error("Marmot Group Data extension not found");
    const nostrGroupIdHex = bytesToHex(marmotGroupData.nostrGroupId);

    // Invite Member A
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

    // Verify 3 members in group
    expect(getGroupMembers(creatorGroup.state).length).toBe(3);

    // All 3 can exchange: Creator sends, A and B decrypt
    await sendMessage(creatorGroup, creatorPubkey, "Pre-removal message");
    const aPreRemoval = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    const bPreRemoval = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(aPreRemoval.some((m) => m.content === "Pre-removal message")).toBe(
      true,
    );
    expect(bPreRemoval.some((m) => m.content === "Pre-removal message")).toBe(
      true,
    );

    // -----------------------------------------------------------------------
    // 2. Creator removes Member A
    // -----------------------------------------------------------------------
    await creatorGroup.commit({
      extraProposals: [Proposals.proposeRemoveUser(memberAPubkey) as any],
    });

    // -----------------------------------------------------------------------
    // 6. Verify member count drops from 3 to 2
    // -----------------------------------------------------------------------
    const membersAfterRemoval = getGroupMembers(creatorGroup.state);
    expect(membersAfterRemoval.length).toBe(2);
    expect(membersAfterRemoval).toContain(creatorPubkey);
    expect(membersAfterRemoval).toContain(memberBPubkey);
    expect(membersAfterRemoval).not.toContain(memberAPubkey);

    // -----------------------------------------------------------------------
    // 3. Member B ingests the removal commit and stays in sync
    // -----------------------------------------------------------------------
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // Follow up with an empty commit to force a path update. ts-mls only
    // generates UpdatePath when there are zero proposals (empty commit) or
    // multiple removals. The path update rotates key material so that the
    // removed member cannot derive the new epoch secrets.
    await creatorGroup.commit();
    await catchUpOnGroupEvents(memberBGroup, nostrGroupIdHex, mockNetwork);
    expect(memberBGroup.state.groupContext.epoch).toBe(
      creatorGroup.state.groupContext.epoch,
    );

    // -----------------------------------------------------------------------
    // 4. Creator sends a new message → Member B decrypts it successfully
    // -----------------------------------------------------------------------
    await sendMessage(
      creatorGroup,
      creatorPubkey,
      "Post-removal secret message",
    );
    const bPostRemoval = await catchUpOnGroupEvents(
      memberBGroup,
      nostrGroupIdHex,
      mockNetwork,
    );
    expect(
      bPostRemoval.some((m) => m.content === "Post-removal secret message"),
    ).toBe(true);

    // -----------------------------------------------------------------------
    // 5. Member A CANNOT decrypt the post-removal message
    // -----------------------------------------------------------------------
    // After the removal commit + path-update commit, Member A no longer has
    // the key material to decrypt messages in the new epoch. ingest() catches
    // decryption errors internally and drops unreadable messages, so we
    // verify that A receives zero application messages.
    const memberAPostRemoval = await catchUpOnGroupEvents(
      memberAGroup,
      nostrGroupIdHex,
      mockNetwork,
    );

    expect(
      memberAPostRemoval.some(
        (m) => m.content === "Post-removal secret message",
      ),
    ).toBe(false);
  });
});
