import { use$ } from "applesauce-react/hooks";
import { bytesToHex } from "applesauce-core/helpers";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { PageHeader } from "@/components/page-header";
import { PageBody } from "@/components/page-body";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SidebarInset } from "@/components/ui/sidebar";
import { withSignIn } from "@/components/with-signIn";
import { getInvitationInboxManager } from "@/lib/runtime";
import { marmotClient$ } from "@/lib/marmot-client";
import type { PendingInvite } from "@/lib/invitation-inbox-manager";

function InviteRow({
  invite,
  isSelected,
  onSelect,
}: {
  invite: PendingInvite;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`w-full text-left border rounded-lg p-3 transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Group invitation</div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {invite.id.slice(0, 16)}...{invite.id.slice(-8)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Received: {new Date(invite.receivedAt * 1000).toLocaleString()}
          </div>
          {invite.cipherSuite && (
            <div className="text-xs text-muted-foreground mt-1">
              CipherSuite: {invite.cipherSuite}
            </div>
          )}
        </div>
        <div className="text-xs px-2 py-1 border rounded capitalize">
          {invite.status}
        </div>
      </div>
    </button>
  );
}

function InvitesPage() {
  const navigate = useNavigate();
  const client = use$(marmotClient$);
  const inbox = getInvitationInboxManager();
  const invites = use$(inbox?.invites$);

  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    setSelectedId((prev) => (prev ? prev : (invites?.[0]?.id ?? "")));
  }, [invites]);

  const pending = useMemo(
    () => (invites ?? []).filter((i) => i.status === "pending"),
    [invites],
  );
  const selected = pending.find((i) => i.id === selectedId) ?? null;

  const handleJoin = async () => {
    if (!client || !selected) return;
    try {
      setError(null);
      setIsJoining(true);
      const group = await client.joinGroupFromWelcome({
        welcomeRumor: selected.welcomeRumor,
        keyPackageEventId: selected.keyPackageEventId,
      });

      await inbox?.setInviteStatus(selected.id, "accepted");
      navigate(`/groups/${bytesToHex(group.state.groupContext.groupId)}`);
    } catch (err) {
      console.error("Failed to join group:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <>
      <AppSidebar title="Invites">
        <div className="flex flex-col">
          <div className="p-2">
            <div className="text-xs text-muted-foreground">
              Pending invitations ({pending.length})
            </div>
          </div>
          {pending.length > 0 ? (
            pending.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                className={`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-1 border-b p-4 text-sm leading-tight text-left ${
                  inv.id === selectedId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : ""
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="font-medium truncate">Group invitation</span>
                  {inv.cipherSuite && (
                    <span className="text-xs text-muted-foreground">
                      {inv.cipherSuite}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(inv.receivedAt * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate w-full">
                  {inv.id.slice(0, 16)}...{inv.id.slice(-8)}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No pending invites.
            </div>
          )}
        </div>
      </AppSidebar>

      <SidebarInset>
        <PageHeader
          items={[{ label: "Home", to: "/" }, { label: "Invites" }]}
        />
        <PageBody>
          {!inbox && (
            <Alert variant="destructive">
              <AlertDescription>
                Invitation inbox manager is not running (not signed in yet?).
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between">
                  <span>Pending invites</span>
                  <span className="text-xs text-muted-foreground">
                    {pending.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pending.length > 0 ? (
                  pending.map((inv) => (
                    <InviteRow
                      key={inv.id}
                      invite={inv}
                      isSelected={inv.id === selectedId}
                      onSelect={() => setSelectedId(inv.id)}
                    />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                    No pending invites.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invite details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selected ? (
                  <>
                    <div className="text-sm">
                      <div className="text-xs text-muted-foreground">
                        Gift wrap id
                      </div>
                      <div className="font-mono text-xs break-all">
                        {selected.id}
                      </div>
                    </div>

                    <Separator />

                    {selected.keyPackageEventId && (
                      <div className="text-sm">
                        <div className="text-xs text-muted-foreground">
                          KeyPackage event
                        </div>
                        <div className="font-mono text-xs break-all">
                          {selected.keyPackageEventId}
                        </div>
                      </div>
                    )}
                    {selected.relays.length > 0 && (
                      <div className="text-sm">
                        <div className="text-xs text-muted-foreground">
                          Relays
                        </div>
                        <div className="text-xs break-all">
                          {selected.relays.join(", ")}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 justify-end pt-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          inbox?.setInviteStatus(selected.id, "archived")
                        }
                        disabled={isJoining}
                      >
                        Archive
                      </Button>
                      <Button
                        onClick={handleJoin}
                        disabled={isJoining || selected.status !== "pending"}
                      >
                        {isJoining ? "Joining..." : "Join group"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                    Select an invite to see details.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </PageBody>
      </SidebarInset>
    </>
  );
}

export default withSignIn(InvitesPage);
