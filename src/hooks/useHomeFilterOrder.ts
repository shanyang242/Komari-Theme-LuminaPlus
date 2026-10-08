import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { ApiRequestError } from "@/services/api";
import {
  buildHomeFilterOrderSettings,
  persistHomeFilterOrder,
  type HomeFilterOrderChange,
} from "@/services/homeFilterOrder";
import type { PublicConfig } from "@/types/komari";

export function useHomeFilterOrder() {
  const { data: me, isError: authError } = useAuth();
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const authorized = !authError && me?.logged_in === true && !!config?.theme;
  const { mutate, reset, isPending, isError, isSuccess, error } = useMutation({
    mutationFn: ({ theme, change }: { theme: string; change: HomeFilterOrderChange }) =>
      persistHomeFilterOrder(theme, change),
    onMutate: async ({ theme, change }) => {
      await queryClient.cancelQueries({ queryKey: ["public"] });
      const previous = queryClient.getQueryData<PublicConfig>(["public"]);
      if (previous?.theme === theme) {
        queryClient.setQueryData<PublicConfig>(["public"], {
          ...previous,
          theme_settings: buildHomeFilterOrderSettings(previous.theme_settings, change),
        });
      }
      return { previousOrder: previous?.theme_settings?.[change.field] };
    },
    onSuccess: (order, { theme, change }) => {
      queryClient.setQueryData<PublicConfig>(["public"], (current) =>
        current?.theme === theme
          ? { ...current, theme_settings: { ...current.theme_settings, [change.field]: order } }
          : current,
      );
    },
    onError: (saveError, { theme, change }, context) => {
      queryClient.setQueryData<PublicConfig>(["public"], (current) => {
        if (!current || current.theme !== theme) return current;
        const settings = { ...current.theme_settings };
        if (context?.previousOrder === undefined) delete settings[change.field];
        else settings[change.field] = context.previousOrder;
        return { ...current, theme_settings: settings };
      });
      if (saveError instanceof ApiRequestError && [401, 403].includes(saveError.status)) {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    },
    onSettled: () => {
      savingRef.current = false;
      void queryClient.invalidateQueries({ queryKey: ["public"] });
    },
  });

  useEffect(() => {
    if (!isError) return;
    const timer = window.setTimeout(reset, 6_000);
    return () => window.clearTimeout(timer);
  }, [isError, reset]);

  const reorder = useCallback((change: HomeFilterOrderChange) => {
    if (!authorized || !config?.theme || savingRef.current) return;
    savingRef.current = true;
    mutate({ theme: config.theme, change });
  }, [authorized, config?.theme, mutate]);

  const accessExpired = error instanceof ApiRequestError && [401, 403].includes(error.status);
  return {
    canReorder: authorized && !isPending && !accessExpired,
    reorder,
    status: isPending ? "正在保存排序" : isSuccess ? "排序已保存" : "",
    errorMessage: isError
      ? accessExpired
        ? "登录状态已失效，请重新登录后调整排序。"
        : "排序保存失败，已恢复原顺序，请重试。"
      : null,
  };
}
