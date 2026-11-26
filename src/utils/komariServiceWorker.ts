const RELOAD_GUARD_KEY = "lumina:komari-sw-reloaded";
const KOMARI_WORKER_PATH = "/sw.js";
const WORKBOX_PRECACHE_PREFIX = "workbox-precache";

type RegistrationLike = Pick<
  ServiceWorkerRegistration,
  "scope" | "active" | "waiting" | "installing"
>;

export type WorkerUpdateResult =
  | "unsupported"
  | "missing"
  | "requested"
  | "failed";

let updateRequest: Promise<WorkerUpdateResult> | undefined;

export function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function getAdminDestination(
  location: Pick<Location, "pathname" | "search" | "hash">,
) {
  const pathname =
    location.pathname === "/admin" || location.pathname === "/admin/"
      ? "/admin/dashboard"
      : location.pathname;
  return `${pathname}${location.search}${location.hash}`;
}

export function isKomariRootServiceWorker(
  registration: RegistrationLike,
  origin: string,
) {
  try {
    const scope = new URL(registration.scope);
    if (scope.origin !== origin || scope.pathname !== "/") return false;

    return [registration.active, registration.waiting, registration.installing].some(
      (worker) => {
        if (!worker) return false;
        const script = new URL(worker.scriptURL);
        return script.origin === origin && script.pathname === KOMARI_WORKER_PATH;
      },
    );
  } catch {
    return false;
  }
}

async function getKomariRegistrations() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return [];
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.filter((registration) =>
    isKomariRootServiceWorker(registration, window.location.origin),
  );
}

function consumeReloadGuard() {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) !== "1") return false;
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return true;
  } catch {
    return false;
  }
}

async function requestKomariServiceWorkerUpdate(): Promise<WorkerUpdateResult> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return "unsupported";
  }

  let registrations: ServiceWorkerRegistration[];
  try {
    registrations = await getKomariRegistrations();
  } catch {
    return "failed";
  }
  if (registrations.length === 0) return "missing";

  const skipReload = consumeReloadGuard();
  const onControllerChange = () => {
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    } catch {
      // A controller change is still safe to reload when storage is unavailable.
    }
    window.location.reload();
  };

  if (!skipReload) {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
      { once: true },
    );
  }

  const results = await Promise.allSettled(
    registrations.map((registration) => registration.update()),
  );
  const requested = results.some((result) => result.status === "fulfilled");

  if (!requested && !skipReload) {
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onControllerChange,
    );
  }
  return requested ? "requested" : "failed";
}

export function updateKomariServiceWorker() {
  updateRequest ??= requestKomariServiceWorkerUpdate();
  return updateRequest;
}

export async function repairKomariServiceWorker() {
  const registrations = await getKomariRegistrations().catch(() => []);
  await Promise.allSettled(
    registrations.map((registration) => registration.unregister()),
  );

  if (typeof caches === "undefined") return;
  let cacheNames: string[];
  try {
    cacheNames = await caches.keys();
  } catch {
    return;
  }
  await Promise.allSettled(
    cacheNames
      .filter((name) => name.startsWith(WORKBOX_PRECACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
}
