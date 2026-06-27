import { Outlet } from "react-router-dom";
import { BackgroundLayer } from "./BackgroundLayer";
import { FloatingControls } from "./FloatingControls";
import { useAppearance } from "@/hooks/useAppearance";
import { useSiteMetadata } from "@/hooks/useSiteMetadata";
import { useMetricColorsSync } from "@/hooks/useMetricColors";

export function AppShell() {
  useAppearance();
  useSiteMetadata();
  // 把后端保存的自定义指标配色应用到所有访客/设备。
  useMetricColorsSync();
  return (
    <div className="relative flex min-h-screen flex-col">
      <BackgroundLayer />
      <FloatingControls />
      {/* max-[720px]:pt-16 给右上角固定的浮动控件留出空间，避免窄屏下展开的控件行盖住首张卡片的头部 */}
      <main className="flex-1 px-3 pb-8 pt-5 max-[720px]:pt-16 sm:px-5 md:px-6 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-[1720px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
