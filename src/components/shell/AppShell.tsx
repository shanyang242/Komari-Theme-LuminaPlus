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
      {/* max-[720px]:pt-16 reserves room for the fixed top-right floating controls
          so an expanded control row can't overlap the first card's header (its OS
          logo / detail link) on narrow / mobile-width layouts. */}
      <main className="flex-1 px-3 pb-8 pt-5 max-[720px]:pt-16 sm:px-5 md:px-6 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-[1720px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
