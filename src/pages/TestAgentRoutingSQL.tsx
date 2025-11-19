import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Headset, TrendingUp, UserCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const TestAgentRoutingSQL = () => {
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any[]>([]);
  const { toast } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      // Load recent conversations with agent data
      const { data: convData, error: convError } = await supabase
        .from('conversations')
        .select('id, customer_name, phone, active_agent, created_at, company_id')
        .order('created_at', { ascending: false })
        .limit(20);

      if (convError) throw convError;
      setConversations(convData || []);

      // Load agent performance data
      const { data: perfData, error: perfError } = await supabase
        .from('agent_performance')
        .select('*')
        .order('routed_at', { ascending: false })
        .limit(50);

      if (perfError) throw perfError;
      setPerformance(perfData || []);

      toast({
        title: 'Data Loaded',
        description: `Found ${convData?.length || 0} conversations and ${perfData?.length || 0} routing records`
      });
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const simulateRouting = async (conversationId: string, agent: 'support' | 'sales' | 'boss') => {
    try {
      // Update conversation active_agent
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ active_agent: agent })
        .eq('id', conversationId);

      if (updateError) throw updateError;

      // Insert agent_performance record
      const { error: perfError } = await supabase
        .from('agent_performance')
        .insert({
          conversation_id: conversationId,
          agent_type: agent,
          routing_confidence: 0.85,
          handoff_occurred: false,
          notes: `Manual test routing to ${agent} agent`
        });

      if (perfError) throw perfError;

      toast({
        title: 'Success',
        description: `Conversation routed to ${agent} agent`
      });

      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Error simulating routing:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update routing',
        variant: 'destructive'
      });
    }
  };

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'support': return <Headset className="h-3 w-3" />;
      case 'sales': return <TrendingUp className="h-3 w-3" />;
      case 'boss': return <UserCircle className="h-3 w-3" />;
      default: return null;
    }
  };

  const getAgentBadge = (agent: string) => {
    const colors = {
      support: 'bg-green-50 text-green-700 border-green-200',
      sales: 'bg-blue-50 text-blue-700 border-blue-200',
      boss: 'bg-purple-50 text-purple-700 border-purple-200'
    };

    return (
      <Badge variant="outline" className={`gap-1 ${colors[agent as keyof typeof colors] || ''}`}>
        {getAgentIcon(agent)}
        <span className="capitalize">{agent}</span>
      </Badge>
    );
  };

  const agentStats = {
    support: performance.filter(p => p.agent_type === 'support').length,
    sales: performance.filter(p => p.agent_type === 'sales').length,
    boss: performance.filter(p => p.agent_type === 'boss' || p.agent_type === 'supervisor_router').length,
    handoffs: performance.filter(p => p.handoff_occurred).length
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Agent Routing System Test Dashboard</CardTitle>
          <CardDescription>
            View and test multi-agent routing by checking database records
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={loadData} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Load Latest Data
          </Button>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{agentStats.support}</div>
                <p className="text-xs text-muted-foreground">Support Routings</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{agentStats.sales}</div>
                <p className="text-xs text-muted-foreground">Sales Routings</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{agentStats.boss}</div>
                <p className="text-xs text-muted-foreground">Boss Handoffs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{agentStats.handoffs}</div>
                <p className="text-xs text-muted-foreground">Total Handoffs</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Recent Conversations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Conversations with Agent Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Active Agent</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No conversations found. Click "Load Latest Data" to fetch records.
                  </TableCell>
                </TableRow>
              ) : (
                conversations.map((conv) => (
                  <TableRow key={conv.id}>
                    <TableCell>{conv.customer_name || 'Unknown'}</TableCell>
                    <TableCell className="font-mono text-sm">{conv.phone}</TableCell>
                    <TableCell>
                      {conv.active_agent ? getAgentBadge(conv.active_agent) : (
                        <Badge variant="outline">Not Set</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(conv.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => simulateRouting(conv.id, 'support')}
                          className="text-green-700"
                        >
                          Support
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => simulateRouting(conv.id, 'sales')}
                          className="text-blue-700"
                        >
                          Sales
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => simulateRouting(conv.id, 'boss')}
                          className="text-purple-700"
                        >
                          Boss
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Agent Performance Log */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Performance Log (Recent 50)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Handoff</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {performance.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No performance data found. Agent routing hasn't been used yet.
                  </TableCell>
                </TableRow>
              ) : (
                performance.map((perf) => (
                  <TableRow key={perf.id}>
                    <TableCell>{getAgentBadge(perf.agent_type)}</TableCell>
                    <TableCell>
                      {perf.routing_confidence ? 
                        `${(perf.routing_confidence * 100).toFixed(0)}%` : 
                        'N/A'
                      }
                    </TableCell>
                    <TableCell>
                      {perf.handoff_occurred ? (
                        <Badge variant="destructive">Yes</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{perf.notes || '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(perf.routed_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default TestAgentRoutingSQL;
