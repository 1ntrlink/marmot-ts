# Core API Reference

Complete API documentation for the Core module.

## Constants

```typescript
// Event Kinds
KEY_PACKAGE_KIND: 443
WELCOME_EVENT_KIND: 444
GROUP_EVENT_KIND: 445
KEY_PACKAGE_RELAY_LIST_KIND: 10051

// Extension Types
MARMOT_GROUP_DATA_EXTENSION_TYPE: 0xf2ee
LAST_RESORT_KEY_PACKAGE_EXTENSION_TYPE: 0x000a

// Protocol Version
MLS_VERSIONS: "1.0"
```

## Credentials

### `createCredential(pubkey: string): CredentialBasic`
Creates an MLS basic credential from a Nostr public key.

### `getCredentialPubkey(credential: Credential): string`
Extracts the Nostr public key from an MLS credential.

### `isSameCredential(a: Credential, b: Credential): boolean`
Compares two credentials for equality.

## Key Packages

### `generateKeyPackage(options): Promise<CompleteKeyPackage>`
Generates a Marmot-compliant key package.

**Options:**
- `pubkey: string` - Nostr public key (hex)
- `ciphersuite: CipherSuite`
- `lifetime?: number` - Validity in seconds (default: 7776000)

**Returns:** `{ publicPackage, privatePackage }`

### `calculateKeyPackageRef(keyPackage, ciphersuiteImpl): Uint8Array`
Computes the key package reference hash.

### `keyPackageDefaultExtensions(): Extension[]`
Returns default extensions for Marmot key packages.

## Groups

### `createGroup(params): Promise<CreateGroupResult>`
Creates a new MLS group with Marmot metadata.

**Params:**
- `creatorKeyPackage: CompleteKeyPackage`
- `marmotGroupData: MarmotGroupData`
- `extensions?: Extension[]`
- `ciphersuiteImpl: CiphersuiteImpl`

**Returns:** `{ clientState }`

### `createSimpleGroup(keyPackage, name, groupId, relays, admins): Promise<CreateGroupResult>`
Simplified group creation for testing.

## Client State

### `extractMarmotGroupData(state): MarmotGroupData`
Extracts Marmot Group Data extension from ClientState.

### `getGroupIdHex(state): string`
Gets the MLS group ID as hex string.

### `getNostrGroupIdHex(state): string`
Gets the Nostr group ID as hex string.

### `getEpoch(state): bigint`
Returns the current epoch number.

### `getMemberCount(state): number`
Returns the number of group members.

### `serializeClientState(state): Uint8Array`
Serializes ClientState to binary TLS format.

### `deserializeClientState(data, ciphersuite, config): ClientState`
Deserializes ClientState from binary format.

## Group Messages

### `createGroupEvent(message, groupId, state, ciphersuite, signer): Promise<UnsignedEvent>`
Creates an encrypted kind 445 event from an MLSMessage.

### `decryptGroupMessageEvent(event, state, ciphersuite): Promise<MLSMessage>`
Decrypts a kind 445 event to extract the MLSMessage.

### `readGroupMessages(events, state, ciphersuite): Promise<GroupMessagePair[]>`
Batch decryption of multiple kind 445 events.

**Returns:** Array of `{ event, message }`

### `sortGroupCommits(pairs): GroupMessagePair[]`
Sorts commits deterministically (epoch → timestamp → event ID).

### `serializeApplicationRumor(rumor): Uint8Array`
Serializes a rumor for use as MLS application data.

### `deserializeApplicationRumor(data): Rumor`
Deserializes MLS application data back to a rumor.

## Group Members

### `getGroupMembers(state): string[]`
Returns array of all member Nostr pubkeys.

### `getPubkeyLeafNodes(state, pubkey): LeafNode[]`
Gets all leaf nodes owned by a pubkey.

### `getPubkeyLeafNodeIndexes(state, pubkey): number[]`
Gets leaf node indexes for a pubkey.

### `getCredentialLeafNodeIndexes(state, credential): number[]`
Gets leaf node indexes by MLS credential.

## Welcome Messages

### `createWelcomeRumor(welcome, relays, keyPackageEventId?): Rumor`
Creates a kind 444 rumor from an MLS Welcome message.

### `getWelcome(event): Welcome`
Extracts MLS Welcome from a kind 444 event.

## Key Package Events

### `createKeyPackageEvent(options): UnsignedEvent`
Creates a kind 443 event for key package distribution.

**Options:**
- `keyPackage: KeyPackage`
- `relays: string[]`
- `client?: KeyPackageClient`

### `createDeleteKeyPackageEvent(eventId, reason?): UnsignedEvent`
Creates a kind 5 deletion event for a key package.

### `getKeyPackage(event): KeyPackage`
Extracts KeyPackage from a kind 443 event.

### `getKeyPackageMLSVersion(event): string`
Gets the MLS protocol version from event tags.

### `getKeyPackageCipherSuiteId(event): string`
Gets the ciphersuite ID from event tags.

## Relay Lists

### `createKeyPackageRelayListEvent(relays): UnsignedEvent`
Creates a kind 10051 relay list event.

### `getKeyPackageRelayList(event): string[]`
Extracts relay URLs from a kind 10051 event.

### `isValidKeyPackageRelayListEvent(event): boolean`
Validates a kind 10051 event structure.

## Marmot Group Data

### `encodeMarmotGroupData(data): Uint8Array`
Encodes MarmotGroupData to TLS binary format.

### `decodeMarmotGroupData(data): MarmotGroupData`
Decodes MarmotGroupData from TLS binary format.

### `marmotGroupDataToExtension(data): Extension`
Converts MarmotGroupData to an MLS Extension.

### `isAdmin(groupData, pubkey): boolean`
Checks if a pubkey is in the admin list.

## Capabilities

### `ensureMarmotCapabilities(capabilities): Capabilities`
Adds required Marmot extensions to capabilities.

### `defaultCapabilities(): Capabilities`
Returns Marmot-compliant default capabilities.

## Extensions

### `supportsMarmotExtensions(extensions): boolean`
Validates that extensions include required Marmot extensions.

### `ensureLastResortExtension(extensions): Extension[]`
Adds last_resort extension if not present.

### `replaceExtension(extensions, newExtension): Extension[]`
Replaces an extension in an array.

## Encoding

### `decodeContent(content, encoding): Uint8Array`
Decodes base64 or hex string to binary.

### `getContentEncoding(event): EncodingFormat`
Detects encoding format from event tags.

## Authentication

### `marmotAuthService: AuthenticationService`
Default authentication service for validating basic credentials.

### `defaultMarmotClientConfig: ClientConfig`
Default ClientConfig with marmotAuthService.
