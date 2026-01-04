import { relaySet } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useState } from "react";
import { extraRelays$, lookupRelays$ } from "../lib/settings";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface RelayConfigProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RelayConfig({ isOpen, onClose }: RelayConfigProps) {
  const lookupRelays = use$(lookupRelays$);
  const extraRelays = use$(extraRelays$);
  const [newLookupRelay, setNewLookupRelay] = useState("");
  const [newExtraRelay, setNewExtraRelay] = useState("");

  const handleAddLookupRelay = () => {
    if (newLookupRelay.trim()) {
      const newRelays = [...new Set([...lookupRelays, newLookupRelay.trim()])];
      lookupRelays$.next(newRelays);
      setNewLookupRelay("");
    }
  };

  const handleRemoveLookupRelay = (relay: string) => {
    const newRelays = lookupRelays.filter((r) => r !== relay);
    lookupRelays$.next(newRelays);
  };

  const handleAddExtraRelay = () => {
    if (newExtraRelay.trim()) {
      const newRelays = [...new Set([...extraRelays, newExtraRelay.trim()])];
      extraRelays$.next(newRelays);
      setNewExtraRelay("");
    }
  };

  const handleRemoveExtraRelay = (relay: string) => {
    const newRelays = extraRelays.filter((r) => r !== relay);
    extraRelays$.next(newRelays);
  };

  const resetLookupRelays = () => {
    lookupRelays$.next(["wss://purplepag.es/", "wss://index.hzrd149.com/"]);
  };

  const resetExtraRelays = () => {
    extraRelays$.next(
      relaySet([
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.primal.net",
        "wss://relay.nostr.band",
        "wss://nostr.wine",
        "wss://relay.snort.social",
      ]),
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent, type: "lookup" | "extra") => {
    if (e.key === "Enter") {
      e.preventDefault();
      switch (type) {
        case "lookup":
          handleAddLookupRelay();
          break;
        case "extra":
          handleAddExtraRelay();
          break;
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Relay Configuration</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Lookup Relays Section */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm">Lookup Relays</CardTitle>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={resetLookupRelays}
                  title="Reset to default lookup relays"
                >
                  Reset
                </Button>
              </div>
              <CardDescription>
                Used for discovering user profiles and relay lists
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lookupRelays.map((relay, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded font-mono">
                      {relay}
                    </code>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => handleRemoveLookupRelay(relay)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 w-full mt-3">
                <Input
                  type="text"
                  placeholder="wss://relay.example.com"
                  value={newLookupRelay}
                  onChange={(e) => setNewLookupRelay(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, "lookup")}
                  className="flex-1"
                />
                <Button
                  onClick={handleAddLookupRelay}
                  disabled={!newLookupRelay.trim()}
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Extra Relays Section */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm">Extra Relays</CardTitle>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={resetExtraRelays}
                  title="Reset to default extra relays"
                >
                  Reset
                </Button>
              </div>
              <CardDescription>
                Always used when fetching events across the app
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {extraRelays.map((relay, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded font-mono">
                      {relay}
                    </code>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => handleRemoveExtraRelay(relay)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 w-full mt-3">
                <Input
                  type="text"
                  placeholder="wss://relay.example.com"
                  value={newExtraRelay}
                  onChange={(e) => setNewExtraRelay(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, "extra")}
                  className="flex-1"
                />
                <Button
                  onClick={handleAddExtraRelay}
                  disabled={!newExtraRelay.trim()}
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
