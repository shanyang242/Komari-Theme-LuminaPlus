import { useSyncExternalStore } from "react";

interface NetworkInformationWithSaveData {
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function getNetworkInformation() {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationWithSaveData }).connection;
}

function getSnapshot() {
  return getNetworkInformation()?.saveData === true;
}

function subscribe(listener: () => void) {
  const connection = getNetworkInformation();
  connection?.addEventListener?.("change", listener);
  return () => connection?.removeEventListener?.("change", listener);
}

/** 背景视频与氛围动效共用省流模式的读取和订阅逻辑。 */
export function useSaveDataPreference() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
