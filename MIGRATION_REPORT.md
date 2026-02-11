# Migration Report: marmot-ts to ts-mls v2

This document outlines the breaking changes and API updates required to migrate from ts-mls v1 to v2 in the marmot-ts library.

## Overview

The migration involved updating **43 files** with **3,278 additions** and **2,226 deletions**. The changes align with the ts-mls v2 API redesign which introduces a more structured approach to MLS operations.

---

## Breaking Changes

### 1. JoinGroup API Redesign

**Before:**

```typescript
clientState = await joinGroup(
  welcome,
  keyPackage.publicPackage,
  keyPackage.privatePackage,
  pskIndex,
  ciphersuiteImpl,
);
```

**After:**

```typescript
clientState = await joinGroup({
  context: {
    cipherSuite: ciphersuiteImpl,
    authService: marmotAuthService,
    externalPsks: {},
  },
  welcome,
  keyPackage: keyPackage.publicPackage,
  privateKeys: keyPackage.privatePackage,
});
```

**Impact:** Major - All join group operations must be refactored to use the params object pattern with nested context.

---

### 2. Codec API Changes (encode/decode)

**Before:**

```typescript
import { decodeWelcome, encodeWelcome } from "ts-mls/welcome.js";
const welcome = decodeWelcome(content, 0);
const serializedWelcome = encodeWelcome(welcome);
```

**After:**

```typescript
import { decode, encode } from "ts-mls";
import { welcomeDecoder, welcomeEncoder } from "ts-mls/welcome.js";
const welcome = decode(welcomeDecoder, content);
const serializedWelcome = encode(welcomeEncoder, welcome);
```

**Impact:** Medium - All codec operations must be updated to use the new decoder/encoder pattern.

**Affected files:**

- [`src/core/welcome.ts`](src/core/welcome.ts)
- [`src/core/message.ts`](src/core/message.ts)
- [`src/core/key-package-event.ts`](src/core/key-package-event.ts)
- [`examples/src/examples/key-package/decode.tsx`](examples/src/examples/key-package/decode.tsx)
- [`examples/src/examples/key-package/explore.tsx`](examples/src/examples/key-package/explore.tsx)

---

### 3. WireFormat Type Changes

**Before:**

```typescript
import { MLSMessage } from "ts-mls/message.js";
return message.wireformat === "mls_private_message";
```

**After:**

```typescript
import { wireformats } from "ts-mls";
import { MlsMessage } from "ts-mls/message.js";
return message.wireformat === wireformats.mls_private_message;
```

**Impact:** Medium - All wireformat comparisons must use the exported `wireformats` constant object.

---

### 4. Ciphersuite Handling Changes

**Before:**

```typescript
import {
  getCiphersuiteFromName,
  getCiphersuiteFromId,
  getCiphersuiteImpl,
} from "ts-mls";
const suite = getCiphersuiteFromName(name);
return await getCiphersuiteImpl(suite, this.cryptoProvider);
```

**After:**

```typescript
import { ciphersuites } from "ts-mls/crypto/ciphersuite.js";
const id = ciphersuites["MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"];
return await this.cryptoProvider.getCiphersuiteImpl(id);
```

**Impact:** Medium - Ciphersuite resolution now uses numeric IDs from the `ciphersuites` mapping table.

**Related changes:**

- Removed imports: `getCiphersuiteFromName`, `getCiphersuiteFromId`, `CiphersuiteId`
- Added import: `ciphersuites` mapping object
- Welcome cipher suite is now a numeric ID, requiring name lookup for logs/debugging

---

### 5. DefaultLifetime Function Change

**Before:**

```typescript
if (timestamp === defaultLifetime.notAfter) {
  return "No expiration";
}
```

**After:**

```typescript
const lifetime = defaultLifetime();
if (timestamp === lifetime.notAfter) {
  return "No expiration";
}
```

**Impact:** Low - `defaultLifetime` is now a function that returns a fresh `Lifetime` value.

---

### 6. PSK Index Changes

**Before:**

```typescript
import { makePskIndex } from "ts-mls";
const pskIndex = makePskIndex(undefined, {});
```

**After:**

```typescript
// PSK handling is now done via the context.externalPsks object
externalPsks: {},
```

**Impact:** Medium - PSK index creation is replaced by external PSKs object in context.

---

### 7. Credential Type Naming Changes

**Before:**

```typescript
import { CredentialTypeName } from "ts-mls/credentialType.js";

const credentialTypes = {
  basic: 1,
  x509: 2,
} as const;

// Compare as string
if (credentialType === "basic") { ... }
```

**After:**

```typescript
import { defaultCredentialTypes, type DefaultCredentialTypeName } from "ts-mls";

// Use the exported constant object
const typeId = defaultCredentialTypes.basic;

// Compare as numeric value
if (credentialType === defaultCredentialTypes.basic) { ... }
```

**Impact:** Medium - `CredentialTypeName` replaced by `DefaultCredentialTypeName`, credential types are now numeric values only.

**Affected files:**

- [`examples/src/components/credential-type-badge.tsx`](examples/src/components/credential-type-badge.tsx)
- [`examples/src/examples/key-package/user-key-packages.tsx`](examples/src/examples/key-package/user-key-packages.tsx)
- [`src/core/key-package-event.ts`](src/core/key-package-event.ts)

---

### 8. ExtensionType Removal

**Before:**

```typescript
import { ExtensionType } from "ts-mls";

function processExtension(type: ExtensionType) { ... }
```

**After:**

```typescript
// ExtensionType is now just a number
function processExtension(type: number) { ... }
```

**Impact:** Low - The `ExtensionType` type export has been removed; extension types are now plain `number` values.

**Affected files:**

- [`examples/src/components/extension-badge.tsx`](examples/src/components/extension-badge.tsx)

---

### 9. Protocol Versions Structure Change

**Before:**

```typescript
import { protocolVersions } from "ts-mls/protocolVersion.js";
// Array lookup
const versionName = protocolVersions[version];
```

**After:**

```typescript
import { protocolVersions } from "ts-mls";
// Object comparison
const versionName = protocolVersions.mls10 === version ? "mls10" : "Unknown";
```

**Impact:** Low - `protocolVersions` changed from an array to an object with named properties.

**Affected files:**

- [`examples/src/components/key-package/leaf-node-capabilities.tsx`](examples/src/components/key-package/leaf-node-capabilities.tsx)

---

### 10. Key Package Event Creation Changes

**Before:**

```typescript
import { createKeyPackageEvent } from "marmot-ts/core/key-package-event";

const unsignedEvent = createKeyPackageEvent({
  keyPackage: keyPackage.publicPackage,
  pubkey,  // Required
  relays,
  client: "marmot-examples",
});
// Returns: UnsignedEvent
```

**After:**

```typescript
import { createKeyPackageEvent } from "marmot-ts/core/key-package-event";

const eventTemplate = createKeyPackageEvent({
  keyPackage: keyPackage.publicPackage,
  relays,
  client: "marmot-examples",
});
// Returns: EventTemplate (no pubkey field)
```

**Impact:** Medium - `pubkey` parameter removed; function now returns `EventTemplate` instead of `UnsignedEvent`.

**Affected files:**

- [`examples/src/examples/key-package/create.tsx`](examples/src/examples/key-package/create.tsx)

---

### 11. GroupStore ClientConfig Removal

**Before:**

```typescript
import { ClientConfig } from "ts-mls/clientConfig.js";

const store = new GroupStore(backend, clientConfig, { prefix });
const clientState = deserializeClientState(entry, clientConfig);
```

**After:**

```typescript
// ClientConfig no longer required
const store = new GroupStore(backend, { prefix });
const clientState = deserializeClientState(entry);
```

**Impact:** Medium - `GroupStore` and `deserializeClientState` no longer require `ClientConfig` parameter.

**Affected files:**

- [`src/store/group-store.ts`](src/store/group-store.ts)
- [`examples/src/lib/group-store.ts`](examples/src/lib/group-store.ts)

---

### 12. EventEmitter Type Updates

**Before:**

```typescript
type GroupStoreEvents = {
  groupLoaded: (group: MarmotGroup<THistory>) => any;
};
```

**After:**

```typescript
type GroupStoreEvents = {
  groupLoaded: (group: MarmotGroup<THistory>) => void;
};
```

**Impact:** Low - Type safety improvement for event emitter generics.

---

### 13. Proposal Types in Tests

**Before:**

```typescript
import { emptyPskIndex } from "ts-mls";
```

**After:**

```typescript
import {
  defaultProposalTypes,
  unsafeTestingAuthenticationService,
} from "ts-mls";
```

**Impact:** Low - Test utilities updated to v2 patterns.

---

### 14. GroupStore Event Emission Fix

**Before:**

```typescript
this.emit("clientStateAdded", clientState);
```

**After:**

```typescript
this.emit("clientStateUpdated", clientState);
```

**Impact:** Low - Bug fix for correct event naming.

---

### 15. Marmot-ts Specific API Improvements (Post-v2 Polish)

The following changes were made to improve consistency and reduce unnecessary complexity in marmot-ts-specific APIs after the ts-mls v2 migration.

#### 15.1 Ciphersuite ID-First Handling

**Before:**

```typescript
// Reverse-mapped numeric ID to name for correctness
const cipherSuiteName = (Object.keys(ciphersuites) as CiphersuiteName[]).find(
  (key) => ciphersuites[key] === welcome.cipherSuite,
);
const ciphersuiteImpl = await this.getCiphersuiteImpl(cipherSuiteName);
```

**After:**

```typescript
// Use numeric ID directly for correctness
const ciphersuiteImpl = await this.getCiphersuiteImplFromId(
  welcome.cipherSuite,
);
// Optional: best-effort name lookup for debuggability only
const cipherSuiteName: CiphersuiteName | undefined = (
  Object.keys(ciphersuites) as CiphersuiteName[]
).find((key) => ciphersuites[key] === welcome.cipherSuite);
```

**Impact:** Low-Medium - Removes failure modes where reverse name lookup could fail even with valid ciphersuite IDs. Name lookup now used only for logs/debugging, never for correctness.

**Affected files:**

- [`src/client/marmot-client.ts`](src/client/marmot-client.ts) - joinGroupFromWelcome uses ID-first
- [`src/core/key-package.ts`](src/core/key-package.ts) - calculateKeyPackageRef uses ID-first

---

#### 15.2 Message Classification Uses ts-mls Constants

**Before:**

```typescript
return (
  isPrivateMessage(pair.message) &&
  pair.message.privateMessage.contentType === 1 // contentTypeValue.application
);
```

**After:**

```typescript
import { contentTypes } from "ts-mls";
return (
  isPrivateMessage(pair.message) &&
  pair.message.privateMessage.contentType === contentTypes.application
);
```

**Impact:** Low - Replaces magic numbers with ts-mls exported constants for better maintainability and future-proofing.

**Affected files:**

- [`src/core/group-message.ts`](src/core/group-message.ts) - isApplicationMessage, isCommitMessage, isProposalMessage

---

#### 15.3 Proposal Naming Consistency

**Before:**

```typescript
import { proposeKickUser } from "marmot-ts/client/group/proposals";
```

**After:**

```typescript
import { proposeRemoveUser } from "marmot-ts/client/group/proposals";
```

**Impact:** Low - Standardizes proposal naming convention across all proposal types (invite, remove, updateMetadata).

**Affected files:**

- [`src/client/group/proposals/remove-member.ts`](src/client/group/proposals/remove-member.ts) - renamed proposeKickUser to proposeRemoveUser

---

## API Changes Summary

| Category                | Before                                    | After                              |
| ----------------------- | ----------------------------------------- | ---------------------------------- |
| **Join operations**     | Positional args                           | Params object with `context`       |
| **Codec functions**     | `decodeX(x, offset)`                      | `decode(xDecoder, data)`           |
| **Wireformat types**    | String literals                           | `wireformats` constant object      |
| **Ciphersuite lookup**  | `getCiphersuiteFromName()`                | `ciphersuites[name]`               |
| **Lifetime**            | Constant object                           | `defaultLifetime()` function       |
| **PSK handling**        | `makePskIndex()`                          | `context.externalPsks` object      |
| **Credential types**    | `CredentialTypeName` / string comparison  | `DefaultCredentialTypeName` / numeric values |
| **Extension types**     | `ExtensionType`                           | `number`                           |
| **Protocol versions**   | Array lookup                              | Object comparison                  |
| **GroupStore**          | Requires `ClientConfig`                   | No config needed                   |
| **Key package events**  | Returns `UnsignedEvent` with `pubkey`     | Returns `EventTemplate`            |

---

## Updated Files

### Core Library Files

- [`src/client/marmot-client.ts`](src/client/marmot-client.ts) - Major refactor for joinGroup API
- [`src/core/message.ts`](src/core/message.ts) - Wireformat type changes
- [`src/core/welcome.ts`](src/core/welcome.ts) - Codec API changes
- [`src/core/auth-service.ts`](src/core/auth-service.ts) - Context pattern updates
- [`src/core/client-state.ts`](src/core/client-state.ts) - Serialization updates
- [`src/core/credential.ts`](src/core/credential.ts) - Type updates
- [`src/core/default-capabilities.ts`](src/core/default-capabilities.ts) - Proposal types
- [`src/core/extensions.ts`](src/core/extensions.ts) - Extension factory updates
- [`src/core/group-message.ts`](src/core/group-message.ts) - Major refactor
- [`src/core/key-package-event.ts`](src/core/key-package-event.ts) - Codec updates and API changes
- [`src/core/key-package.ts`](src/core/key-package.ts) - Type updates
- [`src/core/marmot-group-data.ts`](src/core/marmot-group-data.ts) - Full refactor
- [`src/core/welcome.ts`](src/core/welcome.ts) - Codec API changes

### Group Operations

- [`src/client/group/marmot-group.ts`](src/client/group/marmot-group.ts) - CreateGroup API update
- [`src/client/group/proposals/invite-user.ts`](src/client/group/proposals/invite-user.ts) - Proposal types
- [`src/client/group/proposals/remove-member.ts`](src/client/group/proposals/remove-member.ts) - Proposal types
- [`src/client/group/proposals/update-metadata.ts`](src/client/group/proposals/update-metadata.ts) - Proposal types

### Store Files

- [`src/store/group-store.ts`](src/store/group-store.ts) - Event type updates and ClientConfig removal
- [`src/store/key-package-store.ts`](src/store/key-package-store.ts) - Event type updates
- [`src/store/group-state-store.ts`](src/store/group-state-store.ts) - Documentation updates

### Test Files

- [`src/__tests__/admin-verification.test.ts`](src/__tests__/admin-verification.test.ts) - Full refactor
- [`src/__tests__/credential.test.ts`](src/__tests__/credential.test.ts) - Type updates
- [`src/__tests__/end-to-end-invite-join-message.test.ts`](src/__tests__/end-to-end-invite-join-message.test.ts) - Minor updates
- [`src/__tests__/exports.test.ts`](src/__tests__/exports.test.ts) - New exports
- [`src/__tests__/ingest-commit-race.test.ts`](src/__tests__/ingest-commit-race.test.ts) - Full refactor
- [`src/__tests__/key-package-event.test.ts`](src/__tests__/key-package-event.test.ts) - Codec updates
- [`src/__tests__/key-package.test.ts`](src/__tests__/key-package.test.ts) - Type updates
- [`src/__tests__/marmot-group-data.test.ts`](src/__tests__/marmot-group-data.test.ts) - Full refactor

### Example Files

- [`examples/src/components/credential-type-badge.tsx`](examples/src/components/credential-type-badge.tsx) - Credential type updates
- [`examples/src/components/extension-badge.tsx`](examples/src/components/extension-badge.tsx) - Extension type updates
- [`examples/src/components/cipher-suite-badge.tsx`](examples/src/components/cipher-suite-badge.tsx) - Type widening for number
- [`examples/src/components/key-package/leaf-node-capabilities.tsx`](examples/src/components/key-package/leaf-node-capabilities.tsx) - Protocol versions update
- [`examples/src/examples/group/create.tsx`](examples/src/examples/group/create.tsx) - Ciphersuite handling
- [`examples/src/examples/key-package/create.tsx`](examples/src/examples/key-package/create.tsx) - Key package event creation
- [`examples/src/examples/key-package/decode.tsx`](examples/src/examples/key-package/decode.tsx) - Codec pattern updates
- [`examples/src/examples/key-package/explore.tsx`](examples/src/examples/key-package/explore.tsx) - Codec pattern updates
- [`examples/src/examples/key-package/manager.tsx`](examples/src/examples/key-package/manager.tsx) - Type updates
- [`examples/src/examples/key-package/user-key-packages.tsx`](examples/src/examples/key-package/user-key-packages.tsx) - Credential type comparison
- [`examples/src/lib/group-store.ts`](examples/src/lib/group-store.ts) - Store updates
- [`examples/src/lib/group-subscription-manager.ts`](examples/src/lib/group-subscription-manager.ts) - Type updates
- [`examples/src/lib/marmot-client.ts`](examples/src/lib/marmot-client.ts) - ClientConfig removal

---

## Dependencies

### Updated Dependencies

- `ts-mls` - Updated to v2.0.0 with new API patterns

### Removed Cleanup Code

- Dependency cleanup code removed after migration completion

---

## Migration Steps Summary

1. **Update import statements** - Replace deprecated imports with new v2 imports
2. **Refactor joinGroup calls** - Convert positional args to params object
3. **Update codec usage** - Use `decode(decoder, data)` and `encode(encoder, value)` patterns
4. **Replace wireformat strings** - Use `wireformats` constant object
5. **Update ciphersuite handling** - Use `ciphersuites` mapping for name-to-ID resolution
6. **Convert defaultLifetime usage** - Call as function: `defaultLifetime()`
7. **Update credential types** - Use `defaultCredentialTypes` enum and numeric comparisons
8. **Update extension types** - Replace `ExtensionType` with `number`
9. **Update protocol versions** - Use object comparison instead of array lookup
10. **Remove ClientConfig from GroupStore** - Constructor now only takes backend and options
11. **Update key package events** - Remove `pubkey` parameter from `createKeyPackageEvent`
12. **Update event emitter types** - Change `any` to `void` for listener return types
13. **Update PSK handling** - Use `context.externalPsks` instead of `makePskIndex()`

---

## Testing Notes

All existing tests have been updated to work with the v2 API. The following test utilities are now available from ts-mls for testing:

- `unsafeTestingAuthenticationService` - For tests requiring authentication
- `defaultProposalTypes` - Default proposal type definitions

---

## Rollback Considerations

If rollback to v1 is needed:

1. Revert import changes
2. Restore positional parameter lists for joinGroup functions
3. Restore direct encode/decode functions
4. Restore string literal wireformat comparisons
5. Restore constant defaultLifetime object
6. Restore ClientConfig requirement for GroupStore
7. Restore `pubkey` parameter for `createKeyPackageEvent`

---

_Generated: 2026-02-11_
_Migration commits: 77005f6, 71e9b7c, de7f1b1_
