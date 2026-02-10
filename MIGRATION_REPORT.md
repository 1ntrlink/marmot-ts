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

### 7. EventEmitter Type Updates

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

### 8. Proposal Types in Tests

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

### 9. GroupStore Event Emission Fix

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

### 10. Marmot-ts Specific API Improvements (Post-v2 Polish)

The following changes were made to improve consistency and reduce unnecessary complexity in marmot-ts-specific APIs after the ts-mls v2 migration.

#### 10.1 Ciphersuite ID-First Handling

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

#### 10.2 Message Classification Uses ts-mls Constants

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

#### 10.3 Proposal Naming Consistency

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

| Category               | Before                     | After                         |
| ---------------------- | -------------------------- | ----------------------------- |
| **Join operations**    | Positional args            | Params object with `context`  |
| **Codec functions**    | `decodeX(x, offset)`       | `decode(xDecoder, data)`      |
| **Wireformat types**   | String literals            | `wireformats` constant object |
| **Ciphersuite lookup** | `getCiphersuiteFromName()` | `ciphersuites[name]`          |
| **Lifetime**           | Constant object            | `defaultLifetime()` function  |
| **PSK handling**       | `makePskIndex()`           | `context.externalPsks` object |

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
- [`src/core/key-package-event.ts`](src/core/key-package-event.ts) - Codec updates
- [`src/core/key-package.ts`](src/core/key-package.ts) - Type updates
- [`src/core/marmot-group-data.ts`](src/core/marmot-group-data.ts) - Full refactor
- [`src/core/welcome.ts`](src/core/welcome.ts) - Codec API changes

### Group Operations

- [`src/client/group/marmot-group.ts`](src/client/group/marmot-group.ts) - CreateGroup API update
- [`src/client/group/proposals/invite-user.ts`](src/client/group/proposals/invite-user.ts) - Proposal types
- [`src/client/group/proposals/remove-member.ts`](src/client/group/proposals/remove-member.ts) - Proposal types
- [`src/client/group/proposals/update-metadata.ts`](src/client/group/proposals/update-metadata.ts) - Proposal types

### Store Files

- [`src/store/group-store.ts`](src/store/group-store.ts) - Event type updates
- [`src/store/key-package-store.ts`](src/store/key-package-store.ts) - Event type updates

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

- [`examples/src/examples/group/create.tsx`](examples/src/examples/group/create.tsx) - Ciphersuite handling
- [`examples/src/examples/key-package/create.tsx`](examples/src/examples/key-package/create.tsx) - Key package generation
- [`examples/src/examples/key-package/manager.tsx`](examples/src/examples/key-package/manager.tsx) - Type updates
- [`examples/src/lib/group-store.ts`](examples/src/lib/group-store.ts) - Store updates
- [`examples/src/lib/group-subscription-manager.ts`](examples/src/lib/group-subscription-manager.ts) - Type updates

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
7. **Update event emitter types** - Change `any` to `void` for listener return types
8. **Update PSK handling** - Use `context.externalPsks` instead of `makePskIndex()`

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

---

_Generated: 2026-02-10_
_Migration commits: 77005f6, 71e9b7c, de7f1b1_
