import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns true if the current authed user has the platform-level `admin` role
 * (i.e. an Omanut staff member), as opposed to a per-company role.
 */
export const useIsPlatformAdmin = () => {
  return useQuery({
    queryKey: ["is-platform-admin"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });
};
