# marmot-ts

TypeScript implementation of the [Marmot protocol](https://github.com/marmot-protocol/marmot) - bringing end-to-end encrypted group messaging to Nostr using [MLS (Messaging Layer Security)](https://messaginglayersecurity.rocks/).

This library provides the building blocks for creating secure, decentralized group chat applications on Nostr. It wraps [ts-mls](https://github.com/LukaJCB/ts-mls) with Nostr-specific functionality, similar to how [MDK](https://github.com/marmot-protocol/mdk) wraps [OpenMLS](https://github.com/openmls/openmls).

## Features

- 🔐 **End-to-end encrypted group messaging** using MLS protocol
- 🌐 **Decentralized** - groups operate across Nostr relays
- 🔑 **Key package management** - handle identity and invitations
- 📦 **Storage-agnostic** - bring your own storage backend (LocalForage, IndexedDB, etc.)
- 🔌 **Network-agnostic** - works with any Nostr client library
- 📱 **Cross-platform** - works in browsers and Node.js (v20+)

## Installation

```bash
npm install @internet-privacy/marmots
# or
pnpm add @internet-privacy/marmots
```

## Quick Start

### 1. Initialize the Client

The `MarmotClient` is the main entry point. You need to provide:

- A **signer** (Nostr identity)
- **Storage backends** for groups, key packages, and message history
- A **network interface** (wraps your Nostr relay pool)

```typescript
import { MarmotClient, KeyPackageStore, KeyValueGroupStateBackend } from "@internet-privacy/marmots";
import localforage from "localforage";

// Setup storage backends (example using LocalForage)
const groupStateBackend = new KeyValueGroupStateBackend(
  localforage.createInstance({ name: "marmot-groups" })
);

const keyPackageStore = new KeyPackageStore(
  localforage.createInstance({ name: "marmot-keypackages" })
);

// Network interface (simplified - see full example in marmots-web-chat)
const network = {
  request: (relays, filters) => /* fetch events */,
  subscription: (relays, filters) => /* subscribe to events */,
  publish: (relays, event) => /* publish event */,
  getUserInboxRelays: (pubkey) => /* get NIP-65 inbox relays */,
};

// Create the client
const client = new MarmotClient({
  signer: yourNostrSigner, // EventSigner interface
  groupStateBackend,
  keyPackageStore,
  network,
});
```

### 2. Create a Group

```typescript
const group = await client.createGroup("My Secret Group", {
  description: "A private discussion",
  adminPubkeys: [myPubkey], // Nostr pubkeys (hex)
  relays: ["wss://relay.example.com"],
});

console.log(`Group created with ID: ${bytesToHex(group.id)}`);
```

### 3. Invite Members

```typescript
// Fetch a member's key package event (kind 443) from relays
const keyPackageEvent = await fetchKeyPackageEvent(memberPubkey);

// Send an encrypted invite (creates a NIP-59 Gift Wrap)
await group.inviteByKeyPackageEvent(keyPackageEvent);
```

### 4. Join from Invite

```typescript
// Receive and decrypt the invite (Welcome message)
const inviteRumor = await decryptGiftWrap(giftWrapEvent);

// Join the group
const group = await client.joinGroupFromWelcome({
  welcomeRumor: inviteRumor,
  keyPackageEventId: inviteRumor.tags.find((t) => t[0] === "e")?.[1],
});
```

### 5. Send & Receive Messages

```typescript
// Send a message
import { getEventHash } from "applesauce-core/helpers";

const rumor = {
  kind: 9, // Application message
  pubkey: await signer.getPublicKey(),
  created_at: Math.floor(Date.now() / 1000),
  content: "Hello, group!",
  tags: [],
  id: "",
};
rumor.id = getEventHash(rumor);

await group.sendApplicationRumor(rumor);

// Receive messages by ingesting group events (kind 444)
const results = group.ingest(groupEvents);
for await (const result of results) {
  if (result.kind === "applicationMessage") {
    const message = deserializeApplicationRumor(result.message);
    console.log(`New message: ${message.content}`);
  }
}
```

## Core Concepts

### MarmotClient

The main client class that manages groups and key packages. It provides:

- `createGroup()` - Create a new encrypted group
- `joinGroupFromWelcome()` - Join a group from an invite
- `getGroup(groupId)` - Load an existing group
- `watchGroups()` - Subscribe to group updates
- `watchKeyPackages()` - Subscribe to key package updates

### MarmotGroup

Represents a single encrypted group. Key methods:

- `sendApplicationRumor()` - Send an encrypted message
- `inviteByKeyPackageEvent()` - Invite a new member
- `ingest()` - Process incoming MLS events
- `propose()` - Propose group changes (add/remove members, etc.)
- `commit()` - Finalize proposed changes

### Storage Backends

You must provide implementations for:

1. **GroupStateStoreBackend** - Stores encrypted group state
2. **KeyPackageStore** - Stores your identity key packages
3. **GroupHistoryFactory** (optional) - Stores decrypted message history

**Example using LocalForage:**

```typescript
import localforage from "localforage";
import {
  KeyValueGroupStateBackend,
  KeyPackageStore,
} from "@internet-privacy/marmots";

const groupStateBackend = new KeyValueGroupStateBackend(
  localforage.createInstance({
    name: "user-pubkey-groups",
    storeName: "groups",
  }),
);

const keyPackageStore = new KeyPackageStore(
  localforage.createInstance({
    name: "user-pubkey-keypackages",
    storeName: "keyPackages",
  }),
);
```

The library includes `KeyValueGroupStateBackend` that works with any key-value store implementing `getItem()`, `setItem()`, `removeItem()`, and `keys()`.

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Compile TypeScript
pnpm test      # Run tests (watch mode)
pnpm format    # Format code with Prettier
```
