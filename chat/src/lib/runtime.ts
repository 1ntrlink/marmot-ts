import { defined } from "applesauce-core";
import { firstValueFrom } from "rxjs";

import accounts from "@/lib/accounts";
import { GroupSubscriptionManager } from "@/lib/group-subscription-manager";
import { InvitationInboxManager } from "@/lib/invitation-inbox-manager";
import { marmotClient$ } from "@/lib/marmot-client";

let groupMgr: GroupSubscriptionManager | null = null;
let inviteMgr: InvitationInboxManager | null = null;

/** Shared access to the singleton group subscription manager (if running). */
export function getGroupSubscriptionManager(): GroupSubscriptionManager | null {
  return groupMgr;
}

/** Shared access to the singleton invitation inbox manager (if running). */
export function getInvitationInboxManager(): InvitationInboxManager | null {
  return inviteMgr;
}

/** Pending invite count (for sidebar badge). */
export function getInvitesUnreadCount$() {
  return inviteMgr?.unreadCount$ ?? null;
}

/**
 * Runtime side effects: starts/stops background managers based on auth state.
 *
 * Import this module once (e.g. in `main.tsx`) to activate.
 */
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
