import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";

const FALLBACK_SITENAME = "Komari";
// 后台上传的站点图标由后端存为 ./data/favicon.ico,统一通过该端点提供(见 Komari
// web/public/public.go 的 favicon 优先策略)。自定义 Logo 留空时回退到它。
const FAVICON_URL = "/favicon.ico";

// 顶部品牌标题栏:sticky 固定,向下滚动后叠加毛玻璃背景与分隔线。左侧展示站点 Logo
// (自定义 URL 或后台上传的 favicon)+ 站点名,整体可点击回首页。可在主题管理页开关。
export function SiteHeader() {
  const [searchParams] = useSearchParams();
  // 与 FloatingControls 一致:主题管理视图下不渲染标题栏。
  if (searchParams.get("view") === "theme-manage") {
    return null;
  }
  return <SiteHeaderInner />;
}

function SiteHeaderInner() {
  const { data: config } = usePublicConfig();
  const { showSiteHeader, siteHeaderLogo, isReady } = useThemeSettings();
  const [scrolled, setScrolled] = useState(false);
  // Logo 加载失败(favicon 未上传 / 自定义 URL 失效)时切到站点名首字母占位。
  const [logoFailed, setLogoFailed] = useState(false);
  // 记录上次尝试的 logo 源:源变化时重置失败态,让新地址有机会重新加载。
  const lastLogoSrc = useRef<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // config 未就绪前不渲染,避免站点名/Logo 从占位跳成真实值的闪烁。
  if (!isReady || !showSiteHeader) {
    return null;
  }

  const sitename = config?.sitename?.trim() || FALLBACK_SITENAME;
  // 自定义 Logo 支持 `浅色|深色` 写法(复用背景图归一化),这里只取第一段作为通用 Logo。
  const customLogo = siteHeaderLogo.split("|")[0]?.trim() || "";
  const logoSrc = customLogo || FAVICON_URL;
  if (lastLogoSrc.current !== logoSrc) {
    lastLogoSrc.current = logoSrc;
    if (logoFailed) setLogoFailed(false);
  }

  return (
    <header className={clsx("site-header", scrolled && "is-scrolled")}>
      <div className="site-header-inner">
        <Link to="/" className="site-header-brand" aria-label={`返回 ${sitename} 首页`}>
          <span className="site-header-logo" aria-hidden={logoFailed ? undefined : true}>
            {logoFailed ? (
              <span className="site-header-logo-fallback">{sitename.slice(0, 1)}</span>
            ) : (
              <img
                src={logoSrc}
                alt={sitename}
                onError={() => setLogoFailed(true)}
                loading="eager"
                decoding="async"
              />
            )}
          </span>
          <span className="site-header-name">{sitename}</span>
        </Link>
      </div>
    </header>
  );
}
