import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/services/api";

export function useAuth() {
  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => getMe({ signal }),
    staleTime: 30_000,
    // 切回标签页时即时同步后台登录态
    refetchOnWindowFocus: "always",
  });
}
