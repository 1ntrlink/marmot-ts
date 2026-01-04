import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "../lib/nostr";

export function UserName(props: { pubkey: string }) {
  const profile = use$(() => eventStore.profile(props.pubkey), [props.pubkey]);

  return <>{getDisplayName(profile, props.pubkey.slice(0, 16))}</>;
}

export function UserAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

  return (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full">
      <img
        src={getProfilePicture(
          profile,
          `https://api.dicebear.com/7.x/identicon/svg?seed=${pubkey}`,
        )}
        alt="avatar"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
