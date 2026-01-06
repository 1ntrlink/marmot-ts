import { AppSidebar } from "@/components/app-sidebar";
import { UserAvatar, UserName } from "@/components/nostr-user";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInput,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { contacts$ } from "@/lib/accounts";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { use$ } from "applesauce-react/hooks";
import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { profileSearch } from "../lib/search";
import { useDebounce } from "../hooks/use-debounce";

function ContactItem({ pubkey }: { pubkey: string }) {
  const npub = npubEncode(pubkey);
  const location = useLocation();
  const isActive = location.pathname === `/contacts/${npub}`;

  return (
    <Link
      to={`/contacts/${npub}`}
      className={`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 border-b p-4 text-sm leading-tight last:border-b-0 ${
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
      }`}
    >
      <UserAvatar pubkey={pubkey} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          <UserName pubkey={pubkey} />
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {pubkey.slice(0, 16)}...
        </div>
      </div>
    </Link>
  );
}

export default function ContactsPage() {
  const contacts = use$(contacts$);
  const [query, setQuery] = useState("");

  const debouncedQuery = useDebounce(query, 500);

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    if (!debouncedQuery.trim()) return contacts;

    return profileSearch
      .search(debouncedQuery.toLowerCase().trim())
      .map((r) => r.item);
  }, [contacts, debouncedQuery]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "400px",
        } as React.CSSProperties
      }
    >
      <AppSidebar title="Contacts">
        <div className="flex flex-col">
          <div className="p-2 border-b">
            <SidebarInput
              placeholder="Search contacts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filteredContacts && filteredContacts.length > 0 ? (
            filteredContacts.map((contact) => (
              <ContactItem key={contact.pubkey} pubkey={contact.pubkey} />
            ))
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {query.trim()
                ? "No contacts found matching your search"
                : "No contacts yet"}
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
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Contacts</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        {/* Contact detail sub-pages */}
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
