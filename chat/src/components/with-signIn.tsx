import { use$ } from "applesauce-react/hooks";
import type { ComponentType } from "react";
import { useNavigate } from "react-router";
import accountManager from "../lib/accounts";
import { Button } from "./ui/button";

export function withSignIn<P extends object>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return function WithSignInWrapper(props: P) {
    const navigate = useNavigate();
    const activeAccount = use$(accountManager.active$);

    const handleSignIn = () => {
      navigate("/signin");
    };

    if (!activeAccount) {
      return (
        <div className="flex items-center justify-center min-h-[400px] flex-col gap-4">
          <div className="text-center text-lg">
            This example requires an account:
          </div>
          <Button onClick={handleSignIn}>Sign In</Button>
        </div>
      );
    }

    return <Component {...props} />;
  };
}
