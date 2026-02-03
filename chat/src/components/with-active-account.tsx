import { use$ } from "applesauce-react/hooks";
import type { ComponentType } from "react";
import { Navigate, useLocation } from "react-router";
import accountManager from "../lib/accounts";

export function withActiveAccount<P extends object>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return function WithActiveAccountWrapper(props: P) {
    const location = useLocation();
    const active = use$(accountManager.active$);

    if (!active)
      return (
        <Navigate
          to={{ pathname: "/signin", search: `?to=${location.pathname}` }}
          replace
        />
      );

    return <Component {...props} />;
  };
}
