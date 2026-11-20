import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { REDUCED_MOTION_QUERY } from "@/utils/mediaQuery";
import { buildMeteorRoute, type MapPointPosition, type MeteorRouteGeometry } from "./nodeMapData";

const ROUTE_HOLD_MS = 1000;
const ROUTE_FADE_MS = 600;
const IDLE_MIN_DELAY_MS = 2000;
const IDLE_JITTER_MS = 1500;

interface Meteor extends MeteorRouteGeometry {
  id: number;
  duration: number;
}

export const NodeMapMeteors = memo(function NodeMapMeteors({
  points,
  active,
}: {
  points: ReadonlyArray<MapPointPosition>;
  active: boolean;
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const [meteor, setMeteor] = useState<Meteor | null>(null);

  useEffect(() => {
    setMeteor(null);
    if (!active || reducedMotion || points.length < 2) return;

    let timerId: number | undefined;
    let id = 0;

    function clearTimer() {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
        timerId = undefined;
      }
    }

    function scheduleNextLaunch() {
      clearTimer();
      timerId = window.setTimeout(
        launch,
        IDLE_MIN_DELAY_MS + Math.random() * IDLE_JITTER_MS,
      );
    }

    function launch() {
      const fromIndex = Math.floor(Math.random() * points.length);
      const toIndex = (fromIndex + 1 + Math.floor(Math.random() * (points.length - 1))) % points.length;
      const from = points[fromIndex];
      const to = points[toIndex];
      const route = buildMeteorRoute([from.x, from.y], [to.x, to.y]);
      if (!route) {
        scheduleNextLaunch();
        return;
      }

      const nextMeteor: Meteor = {
        ...route,
        id: ++id,
        duration: 1000 + Math.random() * 2000,
      };
      const totalLifetime = nextMeteor.duration + ROUTE_HOLD_MS + ROUTE_FADE_MS;
      setMeteor(nextMeteor);
      timerId = window.setTimeout(() => {
        setMeteor(null);
        scheduleNextLaunch();
      }, totalLifetime);
    }

    scheduleNextLaunch();
    return clearTimer;
  }, [active, points, reducedMotion]);

  if (!active || reducedMotion || !meteor) return null;

  return (
    <g className="node-map-meteors" aria-hidden="true">
      <MeteorSprite key={meteor.id} meteor={meteor} />
    </g>
  );
}, (previous, next) =>
  previous.active === next.active &&
  previous.points.length === next.points.length &&
  previous.points.every((point, index) => {
    const other = next.points[index];
    return point.code === other.code && point.x === other.x && point.y === other.y;
  }),
);

function MeteorSprite({ meteor }: { meteor: Meteor }) {
  const rawId = useId();
  const maskId = `node-map-mask-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const motionRef = useRef<SVGAnimationElement | null>(null);

  useLayoutEffect(() => {
    // 延至下一帧启动 animateMotion，规避 Chromium 新挂载嵌套节点停在起点
    const frameId = window.requestAnimationFrame(() => {
      motionRef.current?.beginElement?.();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [meteor.id]);

  return (
    <g
      className="node-map-meteor"
      style={{
        animationDuration: `160ms, ${ROUTE_FADE_MS}ms`,
        animationDelay: `0ms, ${meteor.duration + ROUTE_HOLD_MS}ms`,
      }}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={meteor.maskX}
          y={meteor.maskY}
          width={meteor.maskWidth}
          height={meteor.maskHeight}
        >
          <path
            d={meteor.path}
            pathLength="1"
            fill="none"
            stroke="white"
            strokeWidth="8"
            strokeDasharray="1"
            strokeDashoffset="1"
            className="node-map-route-reveal"
            style={{ animationDuration: `${meteor.duration}ms` }}
          />
        </mask>
      </defs>
      <path d={meteor.path} className="node-map-route" mask={`url(#${maskId})`} />
      <g>
        <path d="M -4 -2.5 L 0 0 L -4 2.5" className="node-map-route-tip" />
        <animateMotion
          ref={motionRef}
          path={meteor.path}
          dur={`${meteor.duration}ms`}
          rotate="auto"
          begin="indefinite"
          fill="freeze"
        />
      </g>
    </g>
  );
}
