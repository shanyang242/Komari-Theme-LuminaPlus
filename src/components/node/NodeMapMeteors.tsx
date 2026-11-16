import { useEffect, useId, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { REDUCED_MOTION_QUERY } from "@/utils/mediaQuery";

const ROUTE_HOLD_MS = 1000;
const ROUTE_FADE_MS = 600;

interface Meteor {
  id: number;
  path: string;
  duration: number;
  delay: number;
}

export function NodeMapMeteors({
  regionCodes,
  coordinates,
}: {
  regionCodes: string;
  coordinates: Record<string, number[]>;
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const [meteors, setMeteors] = useState<Meteor[]>([]);

  useEffect(() => {
    setMeteors([]);
    const codes = regionCodes.split(",");
    if (reducedMotion || codes.length < 2) return;

    let launchTimer: number;
    let finishTimer: number;
    let id = 0;

    function schedule(minDelay = 0) {
      launchTimer = window.setTimeout(launch, Math.max(minDelay, 2000 + Math.random() * 1500));
    }

    function launch() {
      const from = Math.floor(Math.random() * codes.length);
      const to = (from + 1 + Math.floor(Math.random() * (codes.length - 1))) % codes.length;
      const [x1, y1] = coordinates[codes[from]];
      const [x2, y2] = coordinates[codes[to]];
      const distance = Math.hypot(x2 - x1, y2 - y1);
      const bend = Math.min(65, distance * 0.2);
      const meteor = {
        id: ++id,
        path: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - bend} ${x2} ${y2}`,
        duration: 1000 + Math.random() * 2000,
        delay: Math.random() * 120,
      };
      const finishAfter = meteor.delay + meteor.duration + ROUTE_HOLD_MS + ROUTE_FADE_MS;
      setMeteors([meteor]);
      finishTimer = window.setTimeout(() => setMeteors([]), finishAfter);
      schedule(finishAfter + 150);
    }

    function onVisibilityChange() {
      window.clearTimeout(launchTimer);
      window.clearTimeout(finishTimer);
      setMeteors([]);
      if (!document.hidden) schedule();
    }

    if (!document.hidden) schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(launchTimer);
      window.clearTimeout(finishTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [coordinates, reducedMotion, regionCodes]);

  if (reducedMotion || meteors.length === 0) return null;

  return (
    <g className="node-map-meteors" aria-hidden="true">
      {meteors.map((meteor) => (
        <MeteorSprite key={meteor.id} meteor={meteor} />
      ))}
    </g>
  );
}

function MeteorSprite({ meteor }: { meteor: Meteor }) {
  const maskId = useId();
  const motionRef = useRef<SVGAnimationElement>(null);

  useEffect(() => {
    motionRef.current?.beginElementAt(meteor.delay / 1000);
  }, [meteor]);

  return (
    <g
      className="node-map-meteor"
      style={{
        animationDuration: `160ms, ${ROUTE_FADE_MS}ms`,
        animationDelay: `${meteor.delay}ms, ${meteor.delay + meteor.duration + ROUTE_HOLD_MS}ms`,
      }}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="620">
          <path
            d={meteor.path}
            pathLength="1"
            fill="none"
            stroke="white"
            strokeWidth="8"
            strokeDasharray="1"
            strokeDashoffset="1"
            className="node-map-route-reveal"
            style={{ animationDuration: `${meteor.duration}ms`, animationDelay: `${meteor.delay}ms` }}
          />
        </mask>
      </defs>
      <path
        d={meteor.path}
        className="node-map-route"
        mask={`url(#${maskId})`}
      />
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
