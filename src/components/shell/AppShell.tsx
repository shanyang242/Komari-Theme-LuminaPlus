import { Outlet } from "react-router-dom";
import { FloatingControls } from "./FloatingControls";
import { useAppearance } from "@/hooks/useAppearance";
import { useSiteMetadata } from "@/hooks/useSiteMetadata";

export function AppShell() {
  useAppearance();
  useSiteMetadata();
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloatingControls />
      <main className="flex-1 px-3 pb-8 pt-5 sm:px-5 md:px-6 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-[1720px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
