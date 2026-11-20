import { useQuery } from "@tanstack/react-query";
import { getLoadRecords, getPingRecords } from "@/services/api";

const RECORD_QUERY_OPTIONS = {
  staleTime: 300_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useLoadRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "load", uuid, hours],
    queryFn: ({ signal }) => getLoadRecords(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    enabled: Boolean(uuid) && enabled,
  });
}

export function usePingRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "ping", uuid, hours],
    queryFn: ({ signal }) => getPingRecords(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    enabled: Boolean(uuid) && enabled,
  });
}
