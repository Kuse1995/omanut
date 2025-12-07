import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { TrendingUp, TrendingDown, Users, MessageSquare, HandHelping, DollarSign, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AIPerformanceMetricsProps {
  companyId: string;
}

export const AIPerformanceMetrics = ({ companyId }: AIPerformanceMetricsProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("7d");
  const [metrics, setMetrics] = useState({
    totalConversations: 0,
    handoffRate: 0,
    averageMessagesPerConversation: 0,
    uniqueCustomers: 0,
    conversionsCount: 0,
  });
  const [agentDistribution, setAgentDistribution] = useState<{ name: string; value: number }[]>([]);
  const [dailyData, setDailyData] = useState<{ date: string; conversations: number; handoffs: number }[]>([]);

  useEffect(() => {
    fetchMetrics();
  }, [companyId, timeRange]);

  const fetchMetrics = async () => {
    setIsLoading(true);
    try {
      const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Fetch conversations
      const { data: conversations } = await supabase
        .from("conversations")
        .select("id, phone, human_takeover, active_agent, created_at")
        .eq("company_id", companyId)
        .gte("created_at", startDate.toISOString());

      // Fetch messages count
      const { data: messages } = await supabase
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", (conversations || []).map(c => c.id));

      // Fetch reservations (conversions)
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id")
        .eq("company_id", companyId)
        .gte("created_at", startDate.toISOString());

      const total = conversations?.length || 0;
      const handoffs = conversations?.filter(c => c.human_takeover).length || 0;
      const uniquePhones = new Set(conversations?.map(c => c.phone).filter(Boolean)).size;
      const msgCount = messages?.length || 0;

      setMetrics({
        totalConversations: total,
        handoffRate: total > 0 ? Math.round((handoffs / total) * 100) : 0,
        averageMessagesPerConversation: total > 0 ? Math.round(msgCount / total) : 0,
        uniqueCustomers: uniquePhones,
        conversionsCount: reservations?.length || 0,
      });

      // Agent distribution
      const agentCounts: Record<string, number> = {};
      conversations?.forEach(c => {
        const agent = c.active_agent || "support";
        agentCounts[agent] = (agentCounts[agent] || 0) + 1;
      });
      setAgentDistribution(
        Object.entries(agentCounts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
      );

      // Daily data
      const dailyMap: Record<string, { conversations: number; handoffs: number }> = {};
      conversations?.forEach(c => {
        const date = new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (!dailyMap[date]) dailyMap[date] = { conversations: 0, handoffs: 0 };
        dailyMap[date].conversations++;
        if (c.human_takeover) dailyMap[date].handoffs++;
      });
      setDailyData(
        Object.entries(dailyMap).map(([date, data]) => ({ date, ...data })).slice(-14)
      );

    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--muted))"];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex justify-end">
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <MessageSquare className="h-8 w-8 text-primary opacity-80" />
              <Badge variant="secondary">Total</Badge>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">{metrics.totalConversations}</div>
              <p className="text-sm text-muted-foreground">Conversations</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <Users className="h-8 w-8 text-blue-500 opacity-80" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">{metrics.uniqueCustomers}</div>
              <p className="text-sm text-muted-foreground">Unique Customers</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <HandHelping className="h-8 w-8 text-yellow-500 opacity-80" />
              {metrics.handoffRate > 20 ? (
                <TrendingUp className="h-4 w-4 text-yellow-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-green-500" />
              )}
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">{metrics.handoffRate}%</div>
              <p className="text-sm text-muted-foreground">Handoff Rate</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <MessageSquare className="h-8 w-8 text-purple-500 opacity-80" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">{metrics.averageMessagesPerConversation}</div>
              <p className="text-sm text-muted-foreground">Avg Messages</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <DollarSign className="h-8 w-8 text-green-500 opacity-80" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">{metrics.conversionsCount}</div>
              <p className="text-sm text-muted-foreground">Conversions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="conversations" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="handoffs" 
                  stroke="hsl(var(--destructive))" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">Conversations</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-destructive" />
                <span className="text-sm text-muted-foreground">Handoffs</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agent Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {agentDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={agentDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {agentDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No data available
              </div>
            )}
            <div className="flex justify-center gap-4 mt-4 flex-wrap">
              {agentDistribution.map((agent, index) => (
                <div key={agent.name} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: COLORS[index % COLORS.length] }} 
                  />
                  <span className="text-sm text-muted-foreground">{agent.name} ({agent.value})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
