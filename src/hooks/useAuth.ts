import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/services/api";

export function useAuth() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    // Keep login state reasonably fresh (a window refocus after returning from
    // the admin login page still revalidates) without refetching on every mount
    // and every focus flicker, which previously spammed /api/me.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
