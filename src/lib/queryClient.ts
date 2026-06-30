import { QueryClient } from "@tanstack/react-query";

/**
 * Single TanStack Query client. Server state (Supabase data, realtime sync)
 * lives here; see spec §3.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
