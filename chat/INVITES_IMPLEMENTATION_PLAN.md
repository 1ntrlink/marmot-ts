# MarmoTS Chat — Invite by KeyPackage Event + Background Subscriptions (Implementation Plan)

This document describes the **implementation plan** (architecture + UI integration) to complete:

1. **Inviting** contacts to a group using their **KeyPackage events** (kind `443`) and sending **Welcomes** (kind `444`) via NIP-59 gift wrap (kind `1059`)
2. **Receiving** invitations in the background and providing an **accept/join** flow
3. Keeping group state and chat messages **in sync** via background subscriptions and ingest

It is intentionally focused on the chat app (`/chat`) and references the canonical example patterns.

---

## Goal and constraints

### Goal

Enable a complete lifecycle:

1. Admin invites a contact by selecting one of the contact’s **KeyPackage events** (kind `443`) and calling [`MarmotGroup.inviteByKeyPackageEvent()`](../src/client/group/marmot-group.ts:541).
2. Invitee receives a **gift-wrapped Welcome** (kind `1059` wrapping rumor kind `444`) and sees it in the app.
3. Invitee accepts, joins the group with [`MarmotClient.joinGroupFromWelcome()`](../src/client/marmot-client.ts:176), and is then able to chat.
4. Both sides stay in sync via a background group subscription that ingests commits + messages.

### Constraints / alignment

- **UX entry points**: Group page is primary; Contact page also exposes “Invite to group”.
- **No duplicate relay subscriptions** per page: background managers own subscriptions; pages register callbacks.
- Keep existing chat styling conventions (shadcn/ui + Tailwind), matching patterns already used in:
  - [`GroupDetailPage`](src/pages/groups/[id].tsx:199)
  - [`ContactDetailPage`](src/pages/contacts/[npub].tsx:432)

---

## Key protocol references (what to implement around)

### Event kinds

- Group events (commits/proposals/application messages): `445` ([`GROUP_EVENT_KIND`](../src/core/protocol.ts:81))
- Welcome rumor: `444` ([`WELCOME_EVENT_KIND`](../src/core/protocol.ts:84))
- KeyPackage event: `443` ([`KEY_PACKAGE_KIND`](../src/core/protocol.ts:13))
- Gift wrap: `1059` (NIP-59; used in the join example)

### “Invite” implementation in the library (already done)

Inviting by KeyPackage event is already implemented as:

```ts
await group.inviteByKeyPackageEvent(selectedKeyPackageEvent);
```

See [`MarmotGroup.inviteByKeyPackageEvent()`](../src/client/group/marmot-group.ts:541).

Important semantics:

- Validates `kind === 443`
- Validates KeyPackage credential identity matches event `pubkey`
- Calls `commit()` with `welcomeRecipients`, ensuring:
  - commit is published + acked before sending welcome (MIP-02)
  - welcome is gift-wrapped to recipient and published to recipient inbox relays

### “Join” implementation in the library (already done)

Joining from a Welcome rumor is implemented as:

```ts
await client.joinGroupFromWelcome({ welcomeRumor, keyPackageEventId });
```

See [`MarmotClient.joinGroupFromWelcome()`](../src/client/marmot-client.ts:176).

---

## Why background subscriptions are required

### Group sync and chat correctness

In MLS, the group epoch advances over time due to commits. If the app doesn’t ingest commits in the background, the UI can drift and eventually fail to decrypt messages.

The `examples` app solves this by subscribing to group events and feeding them into `group.ingest()`.
The manager approach is implemented in the example as [`GroupSubscriptionManager`](../examples/src/lib/group-subscription-manager.ts:16).

The chat app currently has an explicit TODO where this should be wired:

- [`GroupDetailPage` subscription TODO](src/pages/groups/[id].tsx:255)

### Invitation receipt

Welcomes arrive as gift wraps (kind `1059`). Users must receive them **even when not on a “Join” page**, so that invitations appear promptly and aren’t missed.

The example join flow scans gift wraps and unwraps them:

- [`JoinGroup` gift wrap scan + unwrap](../examples/src/examples/group/join.tsx:261)

We will implement the same logic as a background inbox manager.

---

## Implementation architecture

We will implement two background managers in `chat/src/lib/`.

### 1) GroupSubscriptionManager (kind 445 per joined group)

**Responsibility:**

- Maintain one relay subscription per joined group.
- Deduplicate events.
- Call `group.ingest()` to:
  - apply proposals/commits
  - advance epoch
  - update stored group state via `group.save()`
- Extract and forward application messages to the UI.

**Primary reference:**

- [`examples/src/lib/group-subscription-manager.ts`](../examples/src/lib/group-subscription-manager.ts:1)

**Plan for chat:**

- Create file [`chat/src/lib/group-subscription-manager.ts`](src/lib/group-subscription-manager.ts).
- Port the example class and adjust imports to chat:
  - use `marmot-ts` package imports (as the chat app does elsewhere)
  - use shared [`pool`](src/lib/nostr.ts:36)

**Core API shape:**

```ts
export class GroupSubscriptionManager {
  start(): Promise<void>;
  stop(): void;
  reconcileSubscriptions(): Promise<void>;

  onApplicationMessage(
    groupIdHex: string,
    callback: (messages: Rumor[]) => void,
  ): () => void;
}
```

This mirrors [`GroupSubscriptionManager.onApplicationMessage()`](../examples/src/lib/group-subscription-manager.ts:40).

**Important detail:** groupId used in the filter must match the group’s Nostr “h-tag” id.

- The examples use `getNostrGroupIdHex(groupState)` to compute the value used in the `#h` filter (see [`subscribeToGroup()`](../examples/src/lib/group-subscription-manager.ts:112)).
- In chat, we will use the same exported helper from `marmot-ts` (already used in examples).

### 2) InvitationInboxManager (kind 1059 inbox)

**Responsibility:**

- Subscribe to gift wraps (kind `1059`) for the signed-in user.
- Attempt to unwrap each gift wrap with `unlockGiftWrap`.
- If inner rumor is kind `444`, store it as a “pending invite”.

**Primary reference:**

- [`examples/src/examples/group/join.tsx`](../examples/src/examples/group/join.tsx:257)

**Plan for chat:**

- Create file [`chat/src/lib/invitation-inbox-manager.ts`](src/lib/invitation-inbox-manager.ts).
- Define a minimal stored invite model:

```ts
export type PendingInvite = {
  id: string; // giftWrapEvent.id
  giftWrapEvent: NostrEvent;
  welcomeRumor: Rumor; // kind 444
  receivedAt: number; // giftWrapEvent.created_at
  relays: string[]; // from welcome tags
  keyPackageEventId?: string; // from welcome "e" tag
  cipherSuite?: string; // best-effort decode via getWelcome()
  status: "pending" | "accepted" | "archived";
};
```

Decode cipher suite (best effort): use `getWelcome(rumor)` inside try/catch (same pattern as [`JoinGroup`](../examples/src/examples/group/join.tsx:299)).

Persistence:

- Use `localforage` like group/keypackage stores.
- Prefix per user pubkey as in [`groupStore$`](src/lib/group-store.ts:16) and [`keyPackageStore$`](src/lib/key-package-store.ts:10).

Relay set to subscribe to:

- Start with `extraRelays$` (consistent with examples and current chat config).
- Optionally extend to user outboxes/inboxes later (future hardening). `marmot-ts` already supports `network.getUserInboxRelays()` at the library layer for sending welcomes ([`getUserInboxRelays`](src/lib/marmot-client.ts:39)).

---

## Integration points (where these managers start/stop)

### Why: `withSignIn()` is not enough

[`withSignIn()`](src/components/with-signIn.tsx:6) guards routes but does not provide a long-lived “signed-in app root” that runs side effects.

We need a single place that:

- exists while the user is signed in
- starts the managers once client + signer are available
- stops them on logout

### Proposed integration strategy

Add a small “runtime” module in `chat/src/lib/` that:

- lazily constructs singletons once `marmotClient$` emits a client
- subscribes to `accounts.active$` to start/stop

Candidate file: [`chat/src/lib/runtime.ts`](src/lib/runtime.ts).

Pseudo-wiring:

```ts
import accounts from "@/lib/accounts";
import { marmotClient$ } from "@/lib/marmot-client";

let groupMgr: GroupSubscriptionManager | null = null;
let inviteMgr: InvitationInboxManager | null = null;

accounts.active$.subscribe(async (acct) => {
  if (!acct) {
    groupMgr?.stop();
    inviteMgr?.stop();
    groupMgr = null;
    inviteMgr = null;
    return;
  }

  const client = await firstValueFrom(marmotClient$.pipe(defined()));
  groupMgr ??= new GroupSubscriptionManager(client);
  inviteMgr ??= new InvitationInboxManager({ signer: acct.signer });

  await groupMgr.start();
  await inviteMgr.start();
});
```

Where to import this so it runs:

- simplest: import once from [`chat/src/main.tsx`](src/main.tsx:1) (top-level side effect)
- alternative: inside a signed-in layout component (not currently present)

---

## UI/UX plan

### A) Group page: invite flow (primary)

Target file: [`GroupDetailPage`](src/pages/groups/[id].tsx:199).

UI elements:

- Add a header action: **Invite member** button.
  - opens a dialog/drawer to pick a contact + key package event

Flow:

1. Ensure current user is admin (derive from `extractMarmotGroupData(group.state).adminPubkeys`).
2. Show contact picker (existing contacts pages provide patterns; we can reuse search utilities if present).
3. After selecting contact, list their KeyPackage events (kind 443) similar to how [`ContactDetailContent`](src/pages/contacts/[npub].tsx:352) loads key packages.
4. Select one KeyPackage event and call:

```ts
await group.inviteByKeyPackageEvent(selectedKeyPackageEvent);
```

Reference implementation semantics: [`AddMember.inviteMember()`](../examples/src/examples/group/add-member.tsx:545).

UX states:

- disabled button + tooltip if not admin
- loading spinner while inviting
- success toast/alert with “Invitation sent”

### B) Contact page: invite-to-group shortcut (secondary)

Target file: [`ContactDetailPage`](src/pages/contacts/[npub].tsx:432).

UI elements:

- Add “Invite to group” action near Follow/QR.
- Opens a dialog:
  - choose group (from group store)
  - choose one of this contact’s KeyPackage events
  - then call `inviteByKeyPackageEvent` on that group

Rationale:

- Most of the data (contact key packages) is already loaded here.
- This reduces friction to invite a contact when viewing their profile.

### C) Invites page: accept/join

Add a new top-level page and sidebar item:

- route: `/invites`
- list pending invites from the InvitationInboxManager store

UI behavior:

- list of received invites
- selecting an invite shows details + “Join group”

Join action:

```ts
await client.joinGroupFromWelcome({
  welcomeRumor: invite.welcomeRumor,
  keyPackageEventId: invite.keyPackageEventId,
});
```

Reference: [`JoinGroup.handleJoin()`](../examples/src/examples/group/join.tsx:349).

After join:

- navigate to `/groups/:id` for the joined group
- mark invite status as accepted/archived

---

## Updating existing chat behavior

### 1) Group chat message receiving

Replace the TODO in [`GroupDetailPage`](src/pages/groups/[id].tsx:255) by registering to the shared `GroupSubscriptionManager`:

```ts
const unsubscribe = groupSubscriptionManager.onApplicationMessage(
  groupIdHex,
  handleMessagesReceived,
);
```

This is the same pattern as the example chat page’s callback registration ([`Chat` useEffect](../examples/src/examples/group/chat.tsx:481)).

### 2) Persisted epoch sync

No special UI action is required: `group.ingest()` calls `group.save()` and will keep group state updated in `GroupStore`.

---

## Testing and validation plan

### Manual end-to-end scenario

1. Create/publish KeyPackages for both accounts (chat supports this at [`CreateKeyPackagePage`](src/pages/key-packages/create.tsx:38)).
2. User A creates group and becomes admin ([`CreateGroupPage`](src/pages/groups/create.tsx:259)).
3. User A invites User B from group page.
4. User B sees invite appear (background inbox).
5. User B joins; group appears in Groups list.
6. Both send messages; confirm both receive messages and remain in sync after reload.

### Automated coverage (minimal)

- Unit tests in the library already exist for invite/join flows (see [`end-to-end-invite-join-message.test.ts`](../src/__tests__/end-to-end-invite-join-message.test.ts:1)).
- For chat app, add lightweight tests only if the project already has a UI test harness; otherwise rely on manual E2E for now.

---

## Implementation checklist (sequenced)

1. Add [`chat/src/lib/group-subscription-manager.ts`](src/lib/group-subscription-manager.ts) (port from example).
2. Add [`chat/src/lib/invitation-inbox-manager.ts`](src/lib/invitation-inbox-manager.ts) + persistence.
3. Add runtime wiring module (e.g. [`chat/src/lib/runtime.ts`](src/lib/runtime.ts)) and import it from [`chat/src/main.tsx`](src/main.tsx:1).
4. Wire group chat page to manager (remove TODO) ([`GroupDetailPage`](src/pages/groups/[id].tsx:255)).
5. Add group invite UI (primary entry).
6. Add contact invite shortcut UI (secondary entry).
7. Add invites page + sidebar link.
8. Manual E2E validation.
