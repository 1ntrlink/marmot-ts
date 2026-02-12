# Client API Reference

Complete API documentation for the Client module.

## MarmotClient

### Constructor
```typescript
new MarmotClient<THistory>(options: MarmotClientOptions<THistory>)
```

### Methods

**`createGroup(name, options): Promise<MarmotGroup<THistory>>`**  
Creates a new group.

**`joinGroupFromWelcome(welcomeRumor, keyPackageEventId, history?): Promise<MarmotGroup<THistory>>`**  
Joins a group from a Welcome message.

**`getGroup(groupId): Promise<MarmotGroup<THistory>>`**  
Gets a group, loading from storage if needed (cached).

**`loadAllGroups(): Promise<Map<string, MarmotGroup<THistory>>>`**  
Loads all groups from storage.

**`unloadGroup(groupId): Promise<void>`**  
Removes group from cache.

**`destroyGroup(groupId): Promise<void>`**  
Destroys group state and purges history.

**`importGroupFromClientState(state, history?): Promise<MarmotGroup<THistory>>`**  
Imports a group from serialized ClientState.

**`watchGroups(): AsyncGenerator<string[]>`**  
Async generator for group ID list changes.

**`watchKeyPackages(): AsyncGenerator<Uint8Array[]>`**  
Async generator for key package list changes.

### Events
- `groupCreated: { group }`
- `groupJoined: { group }`
- `groupLoaded: { group }`
- `groupImported: { group }`
- `groupUnloaded: { groupId }`
- `groupDestroyed: { groupId }`
- `groupsUpdated: { groups }`

## MarmotGroup

### Properties
- `groupId: string`
- `name: string`
- `description: string`
- `relays: string[]`
- `adminPubkeys: string[]`
- `members: string[]`
- `epoch: bigint`
- `state: ClientState`
- `history?: THistory`

### Methods

**`sendApplicationRumor(rumor): Promise<void>`**  
Encrypts and sends an application message.

**`propose(action, ...args): Promise<void>`**  
Creates and sends a proposal.

**`commit(options?): Promise<void>`**  
Creates and sends a commit.

**`inviteByKeyPackageEvent(event): Promise<WelcomeRecipient[]>`**  
Invites a user (proposes, commits, sends welcome).

**`ingest(events, options?): Promise<void>`**  
Processes incoming group events.

**`save(): Promise<void>`**  
Saves group state to storage.

**`destroy(): Promise<void>`**  
Destroys group and purges history.

### Events
- `stateChanged: { state }`
- `applicationMessage: { rumor }`
- `stateSaved: { groupId }`
- `historyError: { error }`
- `destroyed: { groupId }`

## Proposals

**`proposeInviteUser(keyPackageEvent): ProposalAction<ProposalAdd>`**  
Creates a proposal to add a user.

**`proposeKickUser(pubkey): ProposalAction<ProposalRemove[]>`**  
Creates proposals to remove all devices for a user.

**`proposeUpdateMetadata(metadata): ProposalAction<ProposalGroupContextExtensions>`**  
Creates a proposal to update group metadata.

## GroupRumorHistory

### Constructor
```typescript
new GroupRumorHistory(groupId: string, backend: GroupRumorHistoryBackend)
```

### Static Methods
**`makeFactory(backendFactory): GroupHistoryFactory<GroupRumorHistory>`**  
Creates a factory for use with MarmotClient.

### Methods
**`saveMessage(message): Promise<void>`**  
Saves an MLS application message.

**`saveRumor(rumor): Promise<void>`**  
Saves a rumor directly.

**`queryRumors(filter): Promise<Rumor[]>`**  
Queries rumors with Nostr filters.

**`createPaginatedLoader(filter): AsyncGenerator<Rumor[]>`**  
Creates async generator for paginated loading.

**`purgeMessages(): Promise<void>`**  
Deletes all messages for the group.

### Events
- `rumor: { rumor }`

## Interfaces

### MarmotClientOptions
```typescript
interface MarmotClientOptions<THistory> {
  signer: NostrSigner;
  network: NostrNetworkInterface;
  groupStateStore: GroupStateStore;
  keyPackageStore: KeyPackageStore;
  ciphersuiteImpl?: CiphersuiteImpl;
  groupHistoryFactory?: GroupHistoryFactory<THistory>;
}
```

### NostrNetworkInterface
```typescript
interface NostrNetworkInterface {
  publish(relays: string[], event: NostrEvent): Promise<PublishResponse>;
  request(relays: string[], filters: NostrFilter[]): Promise<NostrEvent[]>;
  subscription(relays: string[], filters: NostrFilter[]): Subscribable<NostrEvent>;
  getUserInboxRelays(pubkey: string): Promise<string[]>;
}
```

### GroupStateStore
```typescript
interface GroupStateStore extends EventEmitter {
  get(groupId: string): Promise<SerializedClientState | null>;
  set(groupId: string, state: SerializedClientState): Promise<void>;
  delete(groupId: string): Promise<void>;
  list(): Promise<string[]>;
}
```

### KeyPackageStore
```typescript
interface KeyPackageStore extends EventEmitter {
  get(ref: Uint8Array): Promise<CompleteKeyPackage | null>;
  set(ref: Uint8Array, keyPackage: CompleteKeyPackage): Promise<void>;
  delete(ref: Uint8Array): Promise<void>;
  list(): Promise<Uint8Array[]>;
}
```

### BaseGroupHistory
```typescript
interface BaseGroupHistory {
  saveMessage(message: MLSMessage): Promise<void>;
  saveRumor(rumor: Rumor): Promise<void>;
  queryRumors(filter: NostrFilter): Promise<Rumor[]>;
  createPaginatedLoader(filter: NostrFilter): AsyncGenerator<Rumor[]>;
  purgeMessages(): Promise<void>;
}
```

## Type Helpers

**`InferGroupType<TClient>`**  
Infers group type from client type.

```typescript
type InferGroupType<TClient extends MarmotClient<any>> = 
  TClient extends MarmotClient<infer THistory> 
    ? MarmotGroup<THistory> 
    : never;
```
