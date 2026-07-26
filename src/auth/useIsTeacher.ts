import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

/** Whether the signed-in user currently holds the teacher role (spec §2). */
export function useIsTeacher() {
  const userId = useAuthStore((s) => s.user?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["is-teacher", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_role", { _role: "teacher" });
      if (error) throw error;
      return data as boolean;
    },
    enabled: !!userId,
  });

  return { isTeacher: data ?? false, isLoading };
}
