import { useEffect, useRef } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePreferences } from "@/hooks/usePreferences";
import { useSaveDataPreference } from "@/hooks/useSaveDataPreference";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { AmbientEffect } from "@/utils/themeSettings";
import { MOBILE_VIEWPORT_QUERY, REDUCED_MOTION_QUERY } from "@/utils/mediaQuery";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  rotation: number;
  spin: number;
  phase: number;
  depth: number;
  life: number;
  color: string;
}

interface FireworkRocket {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  color: string;
  launchAt: number;
  duration: number;
  phase: number;
}

interface EffectScene {
  particles: Particle[];
  rockets: FireworkRocket[];
  nextEventAt: number;
}

const TAU = Math.PI * 2;
const CONFETTI_COLORS = ["#f472b6", "#fbbf24", "#38bdf8", "#a78bfa", "#34d399"];
const FIREWORK_COLORS_DARK = ["#fb7185", "#fbbf24", "#67e8f9", "#c4b5fd", "#86efac"];
const FIREWORK_COLORS_LIGHT = ["#be123c", "#b45309", "#0369a1", "#6d28d9", "#047857"];
const LEAF_COLORS = ["#f59e0b", "#ea580c", "#dc2626", "#ca8a04", "#a16207"];

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomFrom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function particleCount(effect: AmbientEffect, width: number, height: number, isMobile: boolean) {
  const base: Record<AmbientEffect, number> = {
    sakura: 38,
    rain: 116,
    snow: 64,
    leaves: 34,
    confetti: 64,
    fireworks: 0,
  };
  const areaScale = clamp((width * height) / (1440 * 900), 0.58, 1.35);
  return Math.round(base[effect] * areaScale * (isMobile ? 0.56 : 1));
}

function createParticle(effect: AmbientEffect, width: number, height: number): Particle {
  const common = {
    x: random(0, width),
    y: random(0, height),
    vx: 0,
    vy: 0,
    size: 1,
    alpha: 1,
    rotation: random(0, TAU),
    spin: random(-0.02, 0.02),
    phase: random(0, TAU),
    depth: random(0.45, 1),
    life: 1,
    color: "#ffffff",
  };

  switch (effect) {
    case "sakura":
      return {
        ...common,
        vx: random(-0.62, -0.12),
        vy: random(0.45, 1.02),
        size: random(5, 12),
        alpha: random(0.38, 0.78),
        spin: random(-0.035, 0.035),
        color: Math.random() > 0.46 ? "#f9a8d4" : "#fbcfe8",
      };
    case "rain":
      return {
        ...common,
        vx: random(-1.35, -0.72),
        vy: random(7.5, 12.5),
        size: random(10, 25),
        alpha: random(0.16, 0.42),
      };
    case "snow":
      return {
        ...common,
        vx: random(-0.18, 0.18),
        vy: random(0.25, 0.82),
        size: random(1.2, 4.6),
        alpha: random(0.3, 0.76),
      };
    case "leaves":
      return {
        ...common,
        vx: random(-0.52, 0.2),
        vy: random(0.42, 0.92),
        size: random(6, 13),
        alpha: random(0.34, 0.72),
        spin: random(-0.045, 0.045),
        color: randomFrom(LEAF_COLORS),
      };
    case "confetti":
      return {
        ...common,
        vx: random(-0.28, 0.28),
        vy: random(0.62, 1.42),
        size: random(3, 7),
        alpha: random(0.42, 0.78),
        spin: random(-0.08, 0.08),
        color: randomFrom(CONFETTI_COLORS),
      };
    default:
      return common;
  }
}

function createScene(
  effect: AmbientEffect,
  width: number,
  height: number,
  isMobile: boolean,
  now: number,
): EffectScene {
  const count = particleCount(effect, width, height, isMobile);
  return {
    particles: Array.from({ length: count }, () => createParticle(effect, width, height)),
    rockets: [],
    nextEventAt: now + (effect === "fireworks" ? 240 : random(1800, 4200)),
  };
}

function shiftSceneTimeline(scene: EffectScene, duration: number) {
  scene.nextEventAt += duration;
  for (const rocket of scene.rockets) rocket.launchAt += duration;
}

function resetFallingParticle(
  particle: Particle,
  effect: AmbientEffect,
  width: number,
  height: number,
) {
  const replacement = createParticle(effect, width, height);
  Object.assign(particle, replacement, {
    x: random(0, width + 40),
    y: random(-70, -8),
  });
}

function updateAmbientParticles(
  scene: EffectScene,
  effect: AmbientEffect,
  width: number,
  height: number,
  step: number,
) {
  for (const particle of scene.particles) {
    particle.phase += 0.018 * step;
    particle.rotation += particle.spin * step;
    particle.x += (particle.vx + Math.sin(particle.phase) * (effect === "rain" ? 0 : 0.2)) * step;
    particle.y += particle.vy * particle.depth * step;

    const outsideBottom = particle.y > height + particle.size * 3;
    const outsideSide = particle.x < -80 || particle.x > width + 80;
    if (outsideBottom || outsideSide) {
      resetFallingParticle(particle, effect, width, height);
    }
  }
}

function drawPetal(context: CanvasRenderingContext2D, particle: Particle) {
  const size = particle.size;
  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.scale(1, 0.58 + Math.abs(Math.sin(particle.phase)) * 0.42);
  context.globalAlpha = particle.alpha;
  context.fillStyle = particle.color;
  context.beginPath();
  context.moveTo(0, size * 0.25);
  context.bezierCurveTo(-size * 0.82, -size * 0.12, -size * 0.62, -size, 0, -size * 1.18);
  context.bezierCurveTo(size * 0.66, -size * 0.94, size * 0.82, -size * 0.1, 0, size * 0.25);
  context.fill();
  context.restore();
}

function drawLeaf(context: CanvasRenderingContext2D, particle: Particle) {
  const size = particle.size;
  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.scale(1, 0.56 + Math.abs(Math.cos(particle.phase)) * 0.44);
  context.globalAlpha = particle.alpha;
  context.fillStyle = particle.color;
  context.beginPath();
  context.moveTo(0, -size);
  context.bezierCurveTo(size * 0.82, -size * 0.56, size * 0.72, size * 0.56, 0, size);
  context.bezierCurveTo(-size * 0.72, size * 0.56, -size * 0.82, -size * 0.56, 0, -size);
  context.fill();
  context.globalAlpha *= 0.55;
  context.strokeStyle = "#7c2d12";
  context.lineWidth = 0.6;
  context.beginPath();
  context.moveTo(0, -size * 0.82);
  context.lineTo(0, size * 1.22);
  context.stroke();
  context.restore();
}

function drawSnow(context: CanvasRenderingContext2D, particle: Particle, isDark: boolean) {
  const color = isDark ? "#ffffff" : "#94a3b8";
  context.save();
  context.globalAlpha = particle.alpha;
  context.fillStyle = color;
  context.beginPath();
  context.arc(particle.x, particle.y, particle.size, 0, TAU);
  context.fill();
  if (particle.size > 3.5) {
    context.strokeStyle = color;
    context.lineWidth = 0.7;
    for (let index = 0; index < 3; index += 1) {
      const angle = particle.rotation + (Math.PI / 3) * index;
      context.beginPath();
      context.moveTo(
        particle.x - Math.cos(angle) * particle.size * 1.8,
        particle.y - Math.sin(angle) * particle.size * 1.8,
      );
      context.lineTo(
        particle.x + Math.cos(angle) * particle.size * 1.8,
        particle.y + Math.sin(angle) * particle.size * 1.8,
      );
      context.stroke();
    }
  }
  context.restore();
}

function drawConfetti(context: CanvasRenderingContext2D, particle: Particle) {
  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.scale(1, 0.25 + Math.abs(Math.sin(particle.phase)) * 0.75);
  context.globalAlpha = particle.alpha;
  context.fillStyle = particle.color;
  context.fillRect(-particle.size * 0.65, -particle.size * 0.4, particle.size * 1.3, particle.size * 0.8);
  context.restore();
}

function burstFirework(
  scene: EffectScene,
  x: number,
  y: number,
  color: string,
  isMobile: boolean,
) {
  const count = Math.round(isMobile ? random(20, 28) : random(28, 38));
  for (let index = 0; index < count; index += 1) {
    const angle = (TAU * index) / count + random(-0.055, 0.055);
    const speed = random(1.1, 4.1);
    scene.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: random(1.1, 2.5),
      alpha: random(0.55, 0.95),
      rotation: 0,
      spin: 0,
      phase: 0,
      depth: 1,
      life: random(0.72, 1),
      color,
    });
  }
}

function launchFireworkRound(
  scene: EffectScene,
  width: number,
  height: number,
  now: number,
  isDark: boolean,
) {
  const burstCount = Math.random() < 0.5 ? 3 : 4;
  const segmentWidth = 0.8 / burstCount;
  for (let burstIndex = 0; burstIndex < burstCount; burstIndex += 1) {
    const targetX = random(
      width * (0.1 + segmentWidth * burstIndex),
      width * (0.1 + segmentWidth * (burstIndex + 1)),
    );
    const startX = clamp(targetX + random(-width * 0.07, width * 0.07), 12, width - 12);
    const startY = height + random(12, 42);
    scene.rockets.push({
      startX,
      startY,
      targetX,
      targetY: random(height * 0.13, height * 0.5),
      x: startX,
      y: startY,
      color: randomFrom(isDark ? FIREWORK_COLORS_DARK : FIREWORK_COLORS_LIGHT),
      launchAt: now + burstIndex * random(140, 240),
      duration: random(1400, 1950),
      phase: random(0, TAU),
    });
  }
}

function drawRocket(
  context: CanvasRenderingContext2D,
  rocket: FireworkRocket,
  now: number,
  isDark: boolean,
) {
  const progress = clamp((now - rocket.launchAt) / rocket.duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  rocket.x = rocket.startX + (rocket.targetX - rocket.startX) * eased;
  rocket.y = rocket.startY + (rocket.targetY - rocket.startY) * eased;

  const trailLength = 20 + (1 - progress) * 24;
  const gradient = context.createLinearGradient(
    rocket.x,
    rocket.y,
    rocket.x,
    rocket.y + trailLength,
  );
  gradient.addColorStop(0, isDark ? "rgba(255,255,255,0.95)" : rocket.color);
  gradient.addColorStop(0.22, `${rocket.color}cc`);
  gradient.addColorStop(1, `${rocket.color}00`);

  context.save();
  context.globalAlpha = 0.72 + Math.sin(now * 0.025 + rocket.phase) * 0.18;
  context.strokeStyle = gradient;
  context.lineCap = "round";
  context.lineWidth = isDark ? 1.8 : 2.2;
  context.beginPath();
  context.moveTo(rocket.x, rocket.y);
  context.lineTo(rocket.x, rocket.y + trailLength);
  context.stroke();
  context.fillStyle = isDark ? "#ffffff" : rocket.color;
  context.beginPath();
  context.arc(rocket.x, rocket.y, isDark ? 2 : 2.4, 0, TAU);
  context.fill();
  context.restore();
}

function drawFireworks(
  context: CanvasRenderingContext2D,
  scene: EffectScene,
  width: number,
  height: number,
  step: number,
  now: number,
  isMobile: boolean,
  isDark: boolean,
) {
  if (
    now >= scene.nextEventAt &&
    scene.rockets.length === 0 &&
    scene.particles.length < (isMobile ? 45 : 75)
  ) {
    launchFireworkRound(scene, width, height, now, isDark);
    scene.nextEventAt = now + random(3800, 5000);
  }

  const ascendingRockets: FireworkRocket[] = [];
  for (const rocket of scene.rockets) {
    if (now < rocket.launchAt) {
      ascendingRockets.push(rocket);
      continue;
    }
    drawRocket(context, rocket, now, isDark);
    if (now - rocket.launchAt >= rocket.duration) {
      burstFirework(scene, rocket.x, rocket.y, rocket.color, isMobile);
    } else {
      ascendingRockets.push(rocket);
    }
  }
  scene.rockets = ascendingRockets;

  for (const spark of scene.particles) {
    const oldX = spark.x;
    const oldY = spark.y;
    spark.vx *= Math.pow(0.986, step);
    spark.vy = spark.vy * Math.pow(0.988, step) + 0.035 * step;
    spark.x += spark.vx * step;
    spark.y += spark.vy * step;
    spark.life -= 0.0125 * step;
    context.save();
    context.globalAlpha = Math.max(0, spark.alpha * spark.life);
    context.strokeStyle = spark.color;
    context.fillStyle = spark.color;
    context.lineCap = "round";
    context.lineWidth = spark.size * (isDark ? 1 : 1.25);
    context.beginPath();
    context.moveTo(oldX, oldY);
    context.lineTo(spark.x, spark.y);
    context.stroke();
    context.beginPath();
    context.arc(spark.x, spark.y, Math.max(0.8, spark.size * 0.62), 0, TAU);
    context.fill();
    context.restore();
  }
  scene.particles = scene.particles.filter((spark) => spark.life > 0);
}

function drawScene(
  context: CanvasRenderingContext2D,
  scene: EffectScene,
  effect: AmbientEffect,
  width: number,
  height: number,
  step: number,
  now: number,
  isDark: boolean,
  isMobile: boolean,
) {
  context.clearRect(0, 0, width, height);
  if (effect === "fireworks") {
    drawFireworks(context, scene, width, height, step, now, isMobile, isDark);
    return;
  }

  updateAmbientParticles(scene, effect, width, height, step);
  for (const particle of scene.particles) {
    switch (effect) {
      case "sakura":
        drawPetal(context, particle);
        break;
      case "rain":
        context.save();
        context.globalAlpha = particle.alpha;
        context.strokeStyle = isDark ? "#bae6fd" : "#475569";
        context.lineWidth = particle.depth < 0.68 ? 0.55 : 0.9;
        context.beginPath();
        context.moveTo(particle.x, particle.y);
        context.lineTo(particle.x - particle.size * 0.16, particle.y + particle.size);
        context.stroke();
        context.restore();
        break;
      case "snow":
        drawSnow(context, particle, isDark);
        break;
      case "leaves":
        drawLeaf(context, particle);
        break;
      case "confetti":
        drawConfetti(context, particle);
        break;
      default:
        break;
    }
  }
  context.globalAlpha = 1;
}

/** 主题氛围层：轻量覆盖页面，并在关闭、省流或减少动态效果时完全卸载。 */
export function AmbientEffectLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { resolvedAppearance } = usePreferences();
  const { enableAmbientEffect, ambientEffect, isReady } = useThemeSettings();
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY, true);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const saveData = useSaveDataPreference();
  const active = isReady && enableAmbientEffect && !reducedMotion && !saveData;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let scene: EffectScene;
    let frameId = 0;
    let lastFrameAt = performance.now();
    let hiddenAt = document.hidden ? lastFrameAt : null;

    const resize = () => {
      // 绘图坐标必须来自 Canvas 的实际 CSS 尺寸；移动浏览器的 100vh 与
      // window.innerHeight 可能不是同一高度（尤其是地址栏展开时）。
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      const shouldRebuildScene =
        !scene || !isMobile || width === 0 || Math.abs(nextWidth - width) >= 2;
      width = nextWidth;
      height = nextHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.35 : 1.75);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 高度变化仍同步绘图缓冲区，但移动端宽度未变时沿用粒子，避免地址栏
      // 展开/收起触发整层随机重建。
      if (shouldRebuildScene) {
        scene = createScene(ambientEffect, width, height, isMobile, performance.now());
      }
    };

    const render = (now: number) => {
      const step = clamp((now - lastFrameAt) / (1000 / 60), 0.2, 2.4);
      lastFrameAt = now;
      drawScene(
        context,
        scene,
        ambientEffect,
        width,
        height,
        step,
        now,
        resolvedAppearance === "dark",
        isMobile,
      );
      frameId = window.requestAnimationFrame(render);
    };

    const start = () => {
      if (frameId || document.hidden) return;
      lastFrameAt = performance.now();
      frameId = window.requestAnimationFrame(render);
    };
    const stop = () => {
      if (!frameId) return;
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt ??= performance.now();
        stop();
        return;
      }
      if (hiddenAt !== null) {
        shiftSceneTimeline(scene, performance.now() - hiddenAt);
        hiddenAt = null;
      }
      start();
    };

    resize();
    start();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      context.clearRect(0, 0, width, height);
    };
  }, [active, ambientEffect, isMobile, resolvedAppearance]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="ambient-effect-layer"
      data-effect={ambientEffect}
      aria-hidden="true"
    />
  );
}
