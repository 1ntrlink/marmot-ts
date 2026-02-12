# MarmotClient

`MarmotClient` is the top-level interface for managing multiple MLS groups.

## Creating a Client

```typescript
import { MarmotClient } from 'marmot-ts/client';
import { CipherSuite, getCipherSuiteById } from 'ts-mls';

const client = new MarmotClient({
  signer: nostrSigner,
  network: nostrNetworkInterface,
  groupStateStore: myGroupStateStore,
  keyPackageStore: myKeyPackageStore,
  ciphersuiteImpl: getCipherSuiteById(CipherSuite.MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519),
  groupHistoryFactory: myHistoryFactory, // Optional
});
```

## Creating Groups

```typescript
const group = await client.createGroup('Developer Chat', {
  relays: ['wss://relay.damus.io'],
  description: 'A group for TypeScript developers',
  adminPubkeys: [myPubkey],
});
```

## Joining Groups

```typescript
// After receiving a Welcome message
const group = await client.joinGroupFromWelcome(
  welcomeRumor,
  keyPackageEventId,
  historyBackend // Optional
);
```

## Loading Groups

```typescript
// Load single group (cached)
const group = await client.getGroup(groupId);

// Load all groups
const groups = await client.loadAllGroups();

// Unload from cache
await client.unloadGroup(groupId);
```

## Destroying Groups

```typescript
// Destroy group and purge history
await client.destroyGroup(groupId);
```

## Watching Changes

```typescript
// Watch group list
for await (const groups of client.watchGroups()) {
  console.log(`You have ${groups.length} groups`);
}

// Watch key packages
for await (const packages of client.watchKeyPackages()) {
  console.log(`You have ${packages.length} key packages`);
}
```

## Events

```typescript
client.on('groupCreated', ({ group }) => { /* ... */ });
client.on('groupJoined', ({ group }) => { /* ... */ });
client.on('groupLoaded', ({ group }) => { /* ... */ });
client.on('groupImported', ({ group }) => { /* ... */ });
client.on('groupUnloaded', ({ groupId }) => { /* ... */ });
client.on('groupDestroyed', ({ groupId }) => { /* ... */ });
client.on('groupsUpdated', ({ groups }) => { /* ... */ });
```

## Type Inference

```typescript
type MyClient = MarmotClient<MyHistoryType>;
type MyGroup = InferGroupType<MyClient>;
```

See [API Reference](./api) for complete method signatures.
