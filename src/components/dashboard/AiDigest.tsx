import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, MessageSquare, Calendar, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AiDigestProps {
  companyId?: string;
}

interface DigestData {
  conversationsHandled: number;
  reservationsBooked: number;
  handoffsRequested: number;
  topQuestion?: string;
}

/**
 * Human-readable 24-hour AI activity summary for the client dashboard.
 * Designed for non-technical Zambian SMB owners — plain language, clear numbers.
 */
const AiDigest = ({ companyId }: AiDigestProps) => {
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    (async () => {
      try {
        const [convos, reservations, handoffs] = await Promise.all([
          supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .gte("started_at", since),
          supabase
            .from("reservations")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .gte("created_at", since),
          supabase
            .from("boss_conversations")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .gte("created_at", since),
        ]);

        setData({
          conversationsHandled: convos.count || 0,
          reservationsBooked: reservations.count || 0,
          handoffsRequested: handoffs.count || 0,
        });
      } catch (e) {
        console.error("AiDigest error", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  if (loading || !data) return null;
  if (
    data.conversationsHandled === 0 &&
    data.reservationsBooked === 0 &&
    data.handoffsRequested === 0
  ) {
    return null;
  }

  return (
    <Card className="border-border bg-card/50 mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Your AI in the last 24 hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
            <MessageSquare className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-semibold leading-tight">{data.conversationsHandled}</p>
              <p className="text-xs text-muted-foreground">conversations handled</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
            <Calendar className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-semibold leading-tight">{data.reservationsBooked}</p>
              <p className="text-xs text-muted-foreground">bookings created</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-2xl font-semibold leading-tight">{data.handoffsRequested}</p>
              <p className="text-xs text-muted-foreground">moments we pinged you</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AiDigest;
