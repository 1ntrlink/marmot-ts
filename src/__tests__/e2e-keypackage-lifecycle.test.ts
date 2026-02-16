import { bytesToHex } from "@noble/hashes/utils.js";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import type { NostrEvent } from "nostr-tools";
import {
  CiphersuiteImpl,
  defaultCryptoProvider,
  defaultCredentialTypes,
  getCiphersuiteImpl,
} from "ts-mls";
import { beforeEach, describe, expect, it } from "vitest";

import { createCredential, getCredentialPubkey } from "../core/credential";
import { generateKeyPackage, CompleteKeyPackage } from "../core/key-package";
import {
  createKeyPackageEvent,
  createDeleteKeyPackageEvent,
  getKeyPackage,
} from "../core/key-package-event";
import { KEY_PACKAGE_KIND } from "../core/protocol";
import { KeyPackageStore } from "../store/key-package-store";
import { MemoryBackend } from "./ingest-commit-race.test";

// ============================================================================
// Tests
// ============================================================================

describe("End-to-end: KeyPackage lifecycle", () => {
  let account: PrivateKeyAccount<any>;
  let pubkey: string;
  let ciphersuite: CiphersuiteImpl;

  beforeEach(async () => {
    account = PrivateKeyAccount.generateNew();
    pubkey = await account.signer.getPublicKey();
    ciphersuite = await getCiphersuiteImpl(
      "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
      defaultCryptoProvider,
    );
  });

  // -------------------------------------------------------------------------
  // 1. generateKeyPackage() produces valid KeyPackage
  // -------------------------------------------------------------------------
  it("generateKeyPackage() produces valid KeyPackage with correct ciphersuite, credential, and 3-month lifetime", async () => {
    const credential = createCredential(pubkey);
    const keyPackage = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    // Has both public and private components
    expect(keyPackage.publicPackage).toBeDefined();
    expect(keyPackage.privatePackage).toBeDefined();

    // Credential matches
    const kp = keyPackage.publicPackage;
    expect(kp.leafNode.credential.credentialType).toBe(
      defaultCredentialTypes.basic,
    );
    const extractedPubkey = getCredentialPubkey(kp.leafNode.credential);
    expect(extractedPubkey).toBe(pubkey);

    // Ciphersuite matches (numeric id)
    expect(kp.cipherSuite).toBe(ciphersuite.id);

    // Lifetime: notBefore ≤ now ≤ notAfter, notAfter ~ 90 days from now
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    expect(kp.leafNode.lifetime.notBefore).toBeLessThanOrEqual(nowSeconds);
    expect(kp.leafNode.lifetime.notAfter).toBeGreaterThan(nowSeconds);

    const threeMonthsInSeconds = 90n * 24n * 60n * 60n;
    const expectedNotAfter = nowSeconds + threeMonthsInSeconds;
    // Allow 10 seconds of drift for test execution time
    const drift = 10n;
    expect(kp.leafNode.lifetime.notAfter).toBeGreaterThanOrEqual(
      expectedNotAfter - drift,
    );
    expect(kp.leafNode.lifetime.notAfter).toBeLessThanOrEqual(
      expectedNotAfter + drift,
    );
  });

  // -------------------------------------------------------------------------
  // 2. createKeyPackageEvent() produces correct kind 443 event
  // -------------------------------------------------------------------------
  it("createKeyPackageEvent() produces kind 443 event with correct tags and base64 content", async () => {
    const credential = createCredential(pubkey);
    const keyPackage = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    const eventTemplate = createKeyPackageEvent({
      keyPackage: keyPackage.publicPackage,
      relays: ["wss://relay1.test", "wss://relay2.test"],
    });

    // Kind is 443
    expect(eventTemplate.kind).toBe(KEY_PACKAGE_KIND);

    // Content is non-empty base64
    expect(eventTemplate.content.length).toBeGreaterThan(0);
    // Verify base64: should not throw when decoded
    expect(() => atob(eventTemplate.content)).not.toThrow();

    // Required tags
    const getTag = (name: string) =>
      eventTemplate.tags.find((t) => t[0] === name);

    const mlsVersionTag = getTag("mls_protocol_version");
    expect(mlsVersionTag).toBeDefined();
    expect(mlsVersionTag![1]).toBe("1.0");

    const cipherSuiteTag = getTag("mls_ciphersuite");
    expect(cipherSuiteTag).toBeDefined();
    expect(cipherSuiteTag![1]).toMatch(/^0x/); // hex-encoded ciphersuite id

    const encodingTag = getTag("encoding");
    expect(encodingTag).toBeDefined();
    expect(encodingTag![1]).toBe("base64");

    const relayTag = getTag("relays");
    expect(relayTag).toBeDefined();
    expect(relayTag!.slice(1)).toContain("wss://relay1.test/");
    expect(relayTag!.slice(1)).toContain("wss://relay2.test/");

    const extensionsTag = getTag("mls_extensions");
    expect(extensionsTag).toBeDefined();
    // Should have at least the last_resort extension
    expect(extensionsTag!.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // 3. getKeyPackage() round-trips
  // -------------------------------------------------------------------------
  it("getKeyPackage() round-trips: create event from KeyPackage, extract KeyPackage, verify match", async () => {
    const credential = createCredential(pubkey);
    const keyPackage = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    const eventTemplate = createKeyPackageEvent({
      keyPackage: keyPackage.publicPackage,
      relays: ["wss://mock-relay.test"],
    });

    // Sign the event so it has all required NostrEvent fields
    const signed: NostrEvent = await account.signer.signEvent(eventTemplate);

    // Extract the KeyPackage back from the event
    const extracted = getKeyPackage(signed);

    // The extracted KeyPackage should match the original
    expect(extracted.cipherSuite).toBe(keyPackage.publicPackage.cipherSuite);
    expect(extracted.version).toBe(keyPackage.publicPackage.version);

    // Credential identity should match
    const originalPubkey = getCredentialPubkey(
      keyPackage.publicPackage.leafNode.credential,
    );
    const extractedPubkey = getCredentialPubkey(extracted.leafNode.credential);
    expect(extractedPubkey).toBe(originalPubkey);
    expect(extractedPubkey).toBe(pubkey);

    // Lifetime should match
    expect(extracted.leafNode.lifetime.notBefore).toBe(
      keyPackage.publicPackage.leafNode.lifetime.notBefore,
    );
    expect(extracted.leafNode.lifetime.notAfter).toBe(
      keyPackage.publicPackage.leafNode.lifetime.notAfter,
    );
  });

  // -------------------------------------------------------------------------
  // 4. createDeleteKeyPackageEvent() produces kind 5 event
  // -------------------------------------------------------------------------
  it("createDeleteKeyPackageEvent() produces kind 5 event with e-tag referencing original event ID", async () => {
    const credential = createCredential(pubkey);
    const keyPackage = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    const eventTemplate = createKeyPackageEvent({
      keyPackage: keyPackage.publicPackage,
      relays: ["wss://mock-relay.test"],
    });

    const signed: NostrEvent = await account.signer.signEvent(eventTemplate);

    // Create a delete event referencing the signed event
    const deleteEvent = createDeleteKeyPackageEvent({ events: [signed] });

    // Kind 5 (NIP-09 deletion)
    expect(deleteEvent.kind).toBe(5);

    // Should have a "k" tag with the KEY_PACKAGE_KIND
    const kTag = deleteEvent.tags.find((t) => t[0] === "k");
    expect(kTag).toBeDefined();
    expect(kTag![1]).toBe(String(KEY_PACKAGE_KIND));

    // Should have an "e" tag referencing the original event ID
    const eTag = deleteEvent.tags.find((t) => t[0] === "e");
    expect(eTag).toBeDefined();
    expect(eTag![1]).toBe(signed.id);

    // Also works with a plain event ID string
    const deleteEventById = createDeleteKeyPackageEvent({
      events: [signed.id],
    });
    const eTagById = deleteEventById.tags.find((t) => t[0] === "e");
    expect(eTagById).toBeDefined();
    expect(eTagById![1]).toBe(signed.id);

    // Content should be empty
    expect(deleteEvent.content).toBe("");
  });

  // -------------------------------------------------------------------------
  // 5. KeyPackageStore lifecycle: add, list, remove
  // -------------------------------------------------------------------------
  it("KeyPackageStore lifecycle: add → list → add second → list → remove first → verify correct one remains", async () => {
    const store = new KeyPackageStore(new MemoryBackend());
    const credential = createCredential(pubkey);

    // Generate two key packages
    const kp1 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });
    const kp2 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });

    // Add first → list shows 1 entry
    const key1 = await store.add(kp1);
    let listed = await store.list();
    expect(listed.length).toBe(1);
    expect(await store.has(kp1.publicPackage)).toBe(true);

    // Add second → list shows 2 entries
    const key2 = await store.add(kp2);
    listed = await store.list();
    expect(listed.length).toBe(2);
    expect(await store.has(kp2.publicPackage)).toBe(true);

    // Keys should be different (different key material)
    expect(key1).not.toBe(key2);

    // Remove first → list shows 1 entry
    await store.remove(kp1.publicPackage);
    listed = await store.list();
    expect(listed.length).toBe(1);
    expect(await store.has(kp1.publicPackage)).toBe(false);
    expect(await store.has(kp2.publicPackage)).toBe(true);

    // Verify the remaining one is kp2
    const remaining = listed[0];
    const remainingPubkey = getCredentialPubkey(
      remaining.publicPackage.leafNode.credential,
    );
    expect(remainingPubkey).toBe(pubkey);

    // Can retrieve private key for kp2 but not kp1
    expect(await store.getPrivateKey(kp2.publicPackage)).not.toBeNull();
    expect(await store.getPrivateKey(kp1.publicPackage)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 6. Full rotation sequence
  // -------------------------------------------------------------------------
  it("full rotation: generate KP1 → store → generate KP2 → store → remove KP1 → verify KP2 survives", async () => {
    const store = new KeyPackageStore(new MemoryBackend());
    const credential = createCredential(pubkey);

    // Generate and store KP1
    const kp1 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });
    const key1 = await store.add(kp1);
    expect(await store.count()).toBe(1);

    // Simulate rotation: generate and store KP2
    const kp2 = await generateKeyPackage({
      credential,
      ciphersuiteImpl: ciphersuite,
    });
    const key2 = await store.add(kp2);
    expect(await store.count()).toBe(2);

    // Remove old KP1 (rotation complete)
    await store.remove(kp1.publicPackage);
    expect(await store.count()).toBe(1);

    // KP1 is gone
    expect(await store.has(kp1.publicPackage)).toBe(false);
    expect(await store.getPublicKey(kp1.publicPackage)).toBeNull();
    expect(await store.getPrivateKey(kp1.publicPackage)).toBeNull();

    // KP2 survives
    expect(await store.has(kp2.publicPackage)).toBe(true);
    const retrievedPublic = await store.getPublicKey(kp2.publicPackage);
    expect(retrievedPublic).not.toBeNull();
    expect(retrievedPublic!.cipherSuite).toBe(ciphersuite.id);

    const retrievedPrivate = await store.getPrivateKey(kp2.publicPackage);
    expect(retrievedPrivate).not.toBeNull();

    // Full key package retrieval
    const fullKp = await store.getKeyPackage(kp2.publicPackage);
    expect(fullKp).not.toBeNull();
    expect(fullKp!.keyPackageRef).toBeInstanceOf(Uint8Array);
    expect(fullKp!.publicPackage.cipherSuite).toBe(ciphersuite.id);

    // Verify the credential is for the right pubkey
    const storedPubkey = getCredentialPubkey(
      fullKp!.publicPackage.leafNode.credential,
    );
    expect(storedPubkey).toBe(pubkey);
  });
});
