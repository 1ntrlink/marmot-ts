# Getting Started

## What is Marmot?

Marmot is a privacy-preserving group messaging protocol that combines **MLS (Message Layer Security)** for end-to-end encryption with **Nostr** for decentralized message distribution.

**Key Features:**
- **End-to-End Encrypted:** Messages are encrypted using MLS, providing forward secrecy and post-compromise security
- **Decentralized:** Built on Nostr relays, no central server required
- **Privacy-First:** Ephemeral signing keys and gift-wrapped welcome messages protect metadata

## Core Concepts

### MLS (Message Layer Security)
MLS is an IETF standard (RFC 9420) for group messaging security. It provides:
- **Forward Secrecy:** Past messages remain secure even if current keys are compromised
- **Post-Compromise Security:** Security is restored after a compromise through key rotation
- **Efficient Group Operations:** Add/remove members without re-encrypting for everyone

### Nostr
Nostr is a decentralized protocol for distributing signed events over relays. Marmot uses Nostr for:
- **Key Package Distribution:** Publishing cryptographic material for adding members
- **Message Delivery:** Distributing encrypted group messages
- **Welcome Messages:** Onboarding new members to groups

### Key Terms

- **Group:** A collection of members who can exchange encrypted messages
- **Key Package:** Cryptographic material needed to add someone to a group
- **Proposal:** A suggested change to the group (add member, remove member, update metadata)
- **Commit:** A finalized set of proposals that advances the group's encryption state
- **Welcome:** A message sent to new members containing the group state
- **Rumor:** An unsigned Nostr event used as application message content

## Installation

::: code-group
```bash [npm]
npm install marmot-ts
```

```bash [pnpm]
pnpm add marmot-ts
```

```bash [yarn]
yarn add marmot-ts
```
:::

## Basic Usage

This example shows the minimal code to create a group and send a message:

```typescript
import { MarmotClient } from 'marmot-ts/client';
import { NostrPool } from 'your-nostr-library';

// Create a Nostr signer (using your preferred method)
const signer = createSigner(yourPrivateKey);

// Create a network interface for Nostr operations
const network = new NostrPool(/* your config */);

// Initialize the Marmot client
const client = new MarmotClient({
  signer,
  network,
  // Storage implementations (in-memory, IndexedDB, etc.)
  groupStateStore,
  keyPackageStore,
});

// Create a new group
const group = await client.createGroup('My Group', {
  relays: ['wss://relay.example.com'],
  description: 'A private group chat',
});

// Send a message
await group.sendApplicationRumor({
  kind: 1,
  content: 'Hello, Marmot!',
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
});
```

## Next Steps

- **[Core Module](/core)** - Learn about the protocol layer and fundamental building blocks
- **[Client Module](/client)** - Explore the high-level client implementation for building applications
- **[Protocol Specs](https://github.com/parres-hq/marmot)** - Dive deep into the Marmot protocol specifications

## Architecture Overview

```
┌─────────────────────────────────────┐
│      Your Application               │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│      Client Module                  │
│  (MarmotClient, MarmotGroup)        │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│      Core Module                    │
│  (Protocol, Crypto, Messages)       │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│      MLS (ts-mls) + Nostr           │
└─────────────────────────────────────┘
```

The **Client Module** provides high-level APIs for building applications, while the **Core Module** implements the Marmot protocol specifications on top of MLS and Nostr primitives.
