import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

/** Whether the signed-in user currently holds the admin role (spec §2). */
export function useIsAdmin() {
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["is-admin", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) throw error;
      return data as boolean;
    },
    enabled: !!userId,
  });

  return { isAdmin: data ?? false, isLoading };
}
