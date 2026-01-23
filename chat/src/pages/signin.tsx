import { IconArrowLeft } from "@tabler/icons-react";
import { use$ } from "applesauce-react/hooks";
import { Outlet, useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import accountManager from "../lib/accounts";

export default function SignInPage() {
  const navigate = useNavigate();
  const activeAccount = use$(accountManager.active$);

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 w-full min-h-screen">
      <div className="w-full max-w-3xl">
        <div className="relative mb-8">
          {activeAccount && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="absolute left-0 top-1/2 -translate-y-1/2"
            >
              <IconArrowLeft />
            </Button>
          )}
          <h1 className="text-2xl font-bold text-center">Sign In</h1>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
