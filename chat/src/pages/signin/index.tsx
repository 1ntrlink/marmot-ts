import { UserAvatar, UserName } from "@/components/nostr-user";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import accountManager from "@/lib/accounts";
import { use$ } from "applesauce-react/hooks";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import BunkerTab from "./bunker";
import ConnectQrTab from "./connect-qr";
import ExtensionTab from "./extension";
import CreateUserTab from "./create";

interface AccountCardProps {
  account: { id: string; pubkey: string };
  isActive: boolean;
  onSwitch: () => void;
}

function AccountCard({ account, isActive, onSwitch }: AccountCardProps) {
  return (
    <button
      onClick={onSwitch}
      disabled={isActive}
      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
        isActive
          ? "border-primary bg-primary/5 cursor-default"
          : "border-border hover:bg-accent hover:border-accent-foreground cursor-pointer"
      }`}
    >
      <UserAvatar pubkey={account.pubkey} size="lg" />
      <div className="flex-1 text-left min-w-0">
        <div className="font-semibold truncate">
          <UserName pubkey={account.pubkey} />
        </div>
        <code className="text-xs text-muted-foreground truncate block">
          {account.pubkey.slice(0, 16)}...{account.pubkey.slice(-16)}
        </code>
      </div>
      {isActive && (
        <div className="text-sm text-primary font-medium">Active</div>
      )}
    </button>
  );
}

export default function SignInIndexPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const accounts = use$(accountManager.accounts$) || [];
  const activeAccount = use$(accountManager.active$);
  const [activeTab, setActiveTab] = useState<
    "accounts" | "extension" | "bunker" | "qr" | "create"
  >(accounts.length > 0 ? "accounts" : "create");

  const handleSwitchAccount = (accountId: string) => {
    accountManager.setActive(accountId);
    // Navigate back to previous page or home
    const from = (location.state as any)?.from ?? "/";
    navigate(from);
  };

  const handleSuccess = () => {
    // Navigate back to previous page or home after successful sign-in
    const from = (location.state as any)?.from ?? "/";
    navigate(from);
  };

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        <TabsList
          className={`grid w-full mb-6 ${accounts.length > 0 ? "grid-cols-5" : "grid-cols-4"}`}
        >
          {accounts.length > 0 && (
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
          )}
          <TabsTrigger value="create">New User</TabsTrigger>
          <TabsTrigger value="extension">Extension</TabsTrigger>
          <TabsTrigger value="bunker">Bunker</TabsTrigger>
          <TabsTrigger value="qr">QR Code</TabsTrigger>
        </TabsList>

        {accounts.length > 0 && (
          <TabsContent value="accounts">
            <div className="space-y-2">
              {accounts.map((account) => {
                const isActive = activeAccount?.id === account.id;
                return (
                  <AccountCard
                    key={account.id}
                    account={account}
                    isActive={isActive}
                    onSwitch={() => handleSwitchAccount(account.id)}
                  />
                );
              })}
            </div>
          </TabsContent>
        )}

        <TabsContent value="create">
          <CreateUserTab onSuccess={handleSuccess} />
        </TabsContent>
        <TabsContent value="extension">
          <ExtensionTab onSuccess={handleSuccess} />
        </TabsContent>
        <TabsContent value="bunker">
          <BunkerTab onSuccess={handleSuccess} />
        </TabsContent>
        <TabsContent value="qr">
          <ConnectQrTab onSuccess={handleSuccess} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
