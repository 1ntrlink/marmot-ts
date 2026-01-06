import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { type NostrEvent, relaySet } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { Plus } from "lucide-react";
import {
  getKeyPackageCipherSuiteId,
  getKeyPackageClient,
  KEY_PACKAGE_KIND,
} from "marmot-ts";
import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { combineLatest, EMPTY, map, of, switchMap } from "rxjs";
import CipherSuiteBadge from "../components/cipher-suite-badge";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { withSignIn } from "../components/with-signIn";
import accountManager, { keyPackageRelays$, user$ } from "../lib/accounts";
import { eventStore, pool } from "../lib/nostr";
import { extraRelays$ } from "../lib/settings";

/** Observable of all available relays */
const relays$ = combineLatest([
  user$.outboxes$,
  keyPackageRelays$,
  extraRelays$,
]).pipe(
  map(([outboxes, keyPackageRelays, extraRelays]) =>
    relaySet(outboxes, keyPackageRelays, extraRelays),
  ),
);

/** Observable of current user's key packages from all available relays */
const keyPackageSubscription$ = combineLatest([
  accountManager.active$,
  relays$,
]).pipe(
  switchMap(([account, relays]) => {
    if (!account) return EMPTY;

    return pool.subscription(
      relays,
      {
        kinds: [KEY_PACKAGE_KIND],
        authors: [account.pubkey],
      },
      { eventStore },
    );
  }),
);

/** An observable of the key packages events from the event store, use this so deletes are handled automatically in the UI */
const keyPackageTimeline$ = accountManager.active$.pipe(
  switchMap((account) =>
    account
      ? eventStore.timeline({
          kinds: [KEY_PACKAGE_KIND],
          authors: [account.pubkey],
        })
      : of([]),
  ),
);

/** Format timestamp to relative time (e.g., "2 hours ago") */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function KeyPackageItem({ event }: { event: NostrEvent }) {
  const location = useLocation();
  const isActive = location.pathname === `/key-packages/${event.id}`;

  const client = getKeyPackageClient(event);
  const cipherSuiteId = getKeyPackageCipherSuiteId(event);
  const timeAgo = formatTimeAgo(event.created_at);

  return (
    <Link
      to={`/key-packages/${event.id}`}
      className={`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex flex-col items-start gap-2 border-b p-4 text-sm leading-tight last:border-b-0 ${
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <span className="font-medium truncate">
          {client?.name || "Unknown Client"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo}</span>
      </div>
      <div className="flex items-center gap-2">
        {cipherSuiteId !== undefined ? (
          <CipherSuiteBadge cipherSuite={cipherSuiteId} />
        ) : (
          <Badge variant="destructive" className="outline text-xs">
            Unknown
          </Badge>
        )}
      </div>
      <span className="line-clamp-1 w-full text-xs text-muted-foreground font-mono">
        {event.id}
      </span>
    </Link>
  );
}

function KeyPackageManager() {
  // Observables
  const keyPackages = use$(keyPackageTimeline$);

  // Fetch key packages from relays
  use$(keyPackageSubscription$);

  // Filter packages (for now, just show all)
  const filteredPackages = useMemo(() => {
    return keyPackages || [];
  }, [keyPackages]);

  return (
    <>
      <AppSidebar
        title="Key Packages"
        actions={
          <Button asChild size="sm" variant="default">
            <Link to="/key-packages/create">
              <Plus className="h-4 w-4 mr-1" />
              New
            </Link>
          </Button>
        }
      >
        <div className="flex flex-col">
          {keyPackages && keyPackages.length > 0 ? (
            filteredPackages.map((event) => (
              <KeyPackageItem key={event.id} event={event as NostrEvent} />
            ))
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {keyPackages === undefined ? "Loading..." : "No key packages yet"}
            </div>
          )}
        </div>
      </AppSidebar>
      <SidebarInset>
        <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink asChild>
                  <Link to="/">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Key Packages</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        {/* Detail sub-pages */}
        <Outlet />
      </SidebarInset>
    </>
  );
}

export default withSignIn(KeyPackageManager);
