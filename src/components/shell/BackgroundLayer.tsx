import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePreferences } from "@/hooks/usePreferences";
import { useSaveDataPreference } from "@/hooks/useSaveDataPreference";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  applyBackgroundCache,
  buildBackgroundCache,
  parseBackgroundAlignment,
  persistBackgroundCache,
  releaseBackgroundVideo,
  resolveBackgroundVideoSource,
} from "@/utils/background";
import { createBackgroundVideoSession } from "@/utils/backgroundVideoSession";
import type { BackgroundVideoSessionState } from "@/utils/backgroundVideoSession";
import {
  COARSE_POINTER_QUERY,
  MOBILE_VIEWPORT_QUERY,
  REDUCED_MOTION_QUERY,
} from "@/utils/mediaQuery";

/** 图片由 body 伪元素首帧绘制；真实 DOM 只负责桌面视频及其播放生命周期。 */
export function BackgroundLayer() {
  const { resolvedAppearance } = usePreferences();
  const {
    enableBackgroundImage,
    backgroundMediaType,
    backgroundImage,
    backgroundImageMobile,
    backgroundVideo,
    backgroundVideoDark,
    backgroundAlignment,
    surfaceOpacity,
    isReady,
  } = useThemeSettings();
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY, true);
  const hasCoarsePointer = useMediaQuery(COARSE_POINTER_QUERY, true);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const saveData = useSaveDataPreference();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [sessionState, setSessionState] = useState<{
    session: object;
    state: BackgroundVideoSessionState;
  } | null>(null);
  const { size, position } = useMemo(
    () => parseBackgroundAlignment(backgroundAlignment),
    [backgroundAlignment],
  );
  const videoUrl = resolveBackgroundVideoSource({
    enabled: isReady && enableBackgroundImage,
    mediaType: backgroundMediaType,
    videoUrl: backgroundVideo,
    videoUrlDark: backgroundVideoDark,
    appearance: resolvedAppearance,
    isMobile: isMobile || hasCoarsePointer,
    reducedMotion,
    saveData,
  });
  // Identity changes even when the same URL is disabled and later enabled again.
  const videoSession = useMemo(() => ({ videoUrl }), [videoUrl]);
  const videoState = !videoUrl
    ? "inactive"
    : sessionState?.session === videoSession
      ? sessionState.state
      : "loading";
  const backgroundCache = useMemo(
    () =>
      buildBackgroundCache({
        enableBackgroundImage,
        backgroundMediaType,
        backgroundImage,
        backgroundImageMobile,
        backgroundVideo,
        backgroundVideoDark,
        backgroundAlignment,
        surfaceOpacity,
      }),
    [
      enableBackgroundImage,
      backgroundMediaType,
      backgroundImage,
      backgroundImageMobile,
      backgroundVideo,
      backgroundVideoDark,
      backgroundAlignment,
      surfaceOpacity,
    ],
  );

  useEffect(() => {
    if (!isReady) return;
    persistBackgroundCache(backgroundCache);
  }, [isReady, backgroundCache]);

  useEffect(() => {
    if (!isReady) return;
    applyBackgroundCache(backgroundCache, resolvedAppearance, {
      isMobile,
      videoState,
    });
  }, [
    isReady,
    backgroundCache,
    resolvedAppearance,
    isMobile,
    videoState,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const session = createBackgroundVideoSession({
      video,
      source: videoUrl,
      onStateChange: (state) => {
        setSessionState({ session: videoSession, state });
      },
      isHidden: () => document.hidden,
      subscribeVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      release: () => releaseBackgroundVideo(video),
    });

    return session.dispose;
  }, [videoSession, videoUrl]);

  if (!videoUrl) return null;

  return (
    <div
      className="background-video-layer"
      data-state={videoState}
      aria-hidden="true"
    >
      <video
        key={videoUrl}
        ref={videoRef}
        className="background-video-media"
        data-state={videoState}
        loop
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        style={{
          objectFit: size === "auto" ? "none" : size,
          objectPosition: position,
        }}
      />
      <div className="background-video-scrim" />
    </div>
  );
}
