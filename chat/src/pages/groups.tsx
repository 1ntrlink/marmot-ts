import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { from, startWith, switchMap } from "rxjs";

import { use$ } from "applesauce-react/hooks";
import { extractMarmotGroupData, getGroupIdHex } from "marmot-ts";
import { ClientState } from "ts-mls/clientState.js";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { SidebarInset } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { groupStore$, groupStoreChanges$ } from "@/lib/group-store";
import { getGroupSubscriptionManager } from "@/lib/runtime";

function GroupItem({
  groupId,
  clientState,
  onRemove,
}: {
  groupId: string;
  clientState: ClientState;
  onRemove: () => void;
}) {
  const location = useLocation();
  const isActive = location.pathname === `/groups/${groupId}`;
  const marmotData = extractMarmotGroupData(clientState);
  const name = marmotData?.name || "Unnamed Group";

  const groupMgr = getGroupSubscriptionManager();
  const unreadGroups = use$(groupMgr?.unreadGroupIds$ ?? undefined);
  const hasUnread = Array.isArray(unreadGroups)
    ? unreadGroups.includes(groupId)
    : false;

  return (
    <div
      className={`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 border-b text-sm leading-tight last:border-b-0 ${
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
      }`}
    >
      <Link to={`/groups/${groupId}`} className="flex-1 min-w-0 p-4">
        <div className="font-medium truncate flex items-center gap-2">
          <span className="truncate">{name}</span>
          {hasUnread && (
            <span
              className="h-2 w-2 rounded-full bg-destructive shrink-0"
              aria-label="Unread messages"
              title="Unread messages"
            />
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {groupId.slice(0, 16)}...
        </div>
      </Link>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-2"
            onClick={(e) => e.stopPropagation()}
          >
            Remove
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove group?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the group from your local list. No protocol
              action will be published.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onRemove();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function GroupsPage() {
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<
    Set<string>
  >(() => new Set());

  // Get groups list from store
  const groups = use$(
    () =>
      groupStore$.pipe(
        // Ensure the list refreshes when the underlying store changes.
        // Note: `groupStore$` may re-emit the same store instance, so we also
        // listen to a dedicated change signal.
        switchMap((store) =>
          store
            ? groupStoreChanges$.pipe(
                startWith(0),
                switchMap(() => from(store.list())),
              )
            : from(Promise.resolve([])),
        ),
      ),
    [],
  );

  const store = use$(groupStore$);

  // Avoid recomputing group IDs on every re-render.
  // This prevents group list churn while typing in other parts of the UI.
  const groupItems = useMemo(() => {
    const removed = optimisticallyRemovedIds;
    return (groups ?? [])
      .map((clientState: ClientState) => {
        const groupId = getGroupIdHex(clientState);
        return { groupId, clientState };
      })
      .filter(({ groupId }) => !removed.has(groupId));
  }, [groups, optimisticallyRemovedIds]);

  return (
    <>
      <AppSidebar
        title="Groups"
        actions={
          <Label className="flex items-center gap-2 text-sm">
            <span>Unreads</span>
            <Switch className="shadow-none" />
          </Label>
        }
      >
        <div className="flex flex-col">
          <Button asChild className="m-2">
            <Link to="/groups/create">Create Group</Link>
          </Button>
          {groupItems.length > 0 ? (
            groupItems.map(
              ({
                groupId,
                clientState,
              }: {
                groupId: string;
                clientState: ClientState;
              }) => (
                <GroupItem
                  key={groupId}
                  groupId={groupId}
                  clientState={clientState}
                  onRemove={async () => {
                    if (!store) return;
                    setOptimisticallyRemovedIds((prev) => {
                      const next = new Set(prev);
                      next.add(groupId);
                      return next;
                    });

                    try {
                      await store.remove(groupId);
                    } catch {
                      // Revert optimistic remove on failure.
                      setOptimisticallyRemovedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(groupId);
                        return next;
                      });
                    }
                  }}
                />
              ),
            )
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {groups === undefined ? "Loading..." : "No groups yet"}
            </div>
          )}
        </div>
      </AppSidebar>
      <SidebarInset>
        {/* Detail sub-pages */}
        <Outlet />
      </SidebarInset>
    </>
  );
}
