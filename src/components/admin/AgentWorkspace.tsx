import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Headset, Clock, CheckCircle, AlertTriangle, User, Building2,
  MessageSquare, ArrowRight, Timer, Send, StickyNote, Phone, Zap,
  BarChart3, TrendingUp, Target
} from 'lucide-react';

const priorityConfig: Record<string, { color: string; label: string }> = {
  low: { color: 'bg-muted text-muted-foreground', label: 'Low' },
  medium: { color: 'bg-primary/10 text-primary', label: 'Medium' },
  high: { color: 'bg-orange-500/10 text-orange-600', label: 'High' },
  urgent: { color: 'bg-destructive text-destructive-foreground', label: 'Urgent' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  waiting: { color: 'bg-amber-500/10 text-amber-600', label: 'Waiting' },
  assigned: { color: 'bg-blue-500/10 text-blue-600', label: 'Assigned' },
  active: { color: 'bg-green-500/10 text-green-600', label: 'Active' },
  on_hold: { color: 'bg-muted text-muted-foreground', label: 'On Hold' },
  completed: { color: 'bg-muted text-muted-foreground', label: 'Completed' },
};

function SLACountdown({ deadline }: { deadline: string | null }) {
  const [timeLeft, setTimeLeft] = useState('');
  const [urgency, setUrgency] = useState<'ok' | 'warning' | 'breach'>('ok');

  useEffect(() => {
    if (!deadline) { setTimeLeft('No SLA'); return; }
    const interval = setInterval(() => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('BREACHED');
        setUrgency('breach');
      } else {
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        setTimeLeft(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
        setUrgency(mins < 10 ? 'breach' : mins < 30 ? 'warning' : 'ok');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const colors = {
    ok: 'text-green-600',
    warning: 'text-amber-500',
    breach: 'text-destructive font-bold',
  };

  return (
    <span className={`flex items-center gap-1 text-xs ${colors[urgency]}`}>
      <Timer className="h-3 w-3" />
      {timeLeft}
    </span>
  );
}

export const AgentWorkspace = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('waiting');
  const [noteContent, setNoteContent] = useState('');
  const [replyText, setReplyText] = useState('');

  // Fetch queue items
  const { data: queueItems, isLoading } = useQuery({
    queryKey: ['agent-queue', selectedCompany?.id, statusFilter],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      let query = supabase
        .from('agent_queue')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany?.id,
  });

  // Fetch conversation messages when an item is selected
  const { data: messages } = useQuery({
    queryKey: ['queue-messages', selectedItem?.conversation_id],
    queryFn: async () => {
      if (!selectedItem?.conversation_id) return [];
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedItem.conversation_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedItem?.conversation_id,
  });

  // Fetch ticket notes
  const { data: notes } = useQuery({
    queryKey: ['ticket-notes', selectedItem?.ticket_id],
    queryFn: async () => {
      if (!selectedItem?.ticket_id) return [];
      const { data, error } = await supabase
        .from('ticket_notes')
        .select('*')
        .eq('ticket_id', selectedItem.ticket_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedItem?.ticket_id,
  });

  // Claim mutation
  const claimMutation = useMutation({
    mutationFn: async (queueId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('agent_queue')
        .update({ 
          status: 'assigned', 
          assigned_agent_id: user.id,
          claimed_at: new Date().toISOString()
        })
        .eq('id', queueId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-queue'] });
      toast.success('Ticket claimed successfully');
    },
  });

  // Send reply mutation - sends via WhatsApp through edge function
  const sendReplyMutation = useMutation({
    mutationFn: async ({ conversationId, message }: { conversationId: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: { conversationId, message }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-messages'] });
      setReplyText('');
      toast.success('Reply sent via WhatsApp');
    },
    onError: (err: any) => {
      toast.error(`Failed to send: ${err.message}`);
    }
  });

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async (queueId: string) => {
      const { error } = await supabase
        .from('agent_queue')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', queueId);
      if (error) throw error;
      // Also unpause the conversation
      if (selectedItem?.conversation_id) {
        await supabase.from('conversations').update({
          is_paused_for_human: false,
          human_takeover: false
        }).eq('id', selectedItem.conversation_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-queue'] });
      setSelectedItem(null);
      toast.success('Ticket resolved');
    },
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('ticket_notes')
        .insert({ ticket_id: ticketId, author_id: user.id, content, is_internal: true });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-notes'] });
      setNoteContent('');
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!selectedCompany?.id) return;
    const channel = supabase
      .channel('agent-queue-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agent_queue',
        filter: `company_id=eq.${selectedCompany.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['agent-queue'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedCompany?.id, queryClient]);

  // Performance metrics query
  const { data: performanceData } = useQuery({
    queryKey: ['agent-performance-metrics', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return null;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Tickets completed today
      const { count: todayCount } = await supabase
        .from('agent_queue')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', selectedCompany.id)
        .eq('status', 'completed')
        .gte('completed_at', todayStart);

      // Tickets completed this week
      const { count: weekCount } = await supabase
        .from('agent_queue')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', selectedCompany.id)
        .eq('status', 'completed')
        .gte('completed_at', weekStart);

      // Avg wait time (completed items this week)
      const { data: completedItems } = await supabase
        .from('agent_queue')
        .select('wait_time_seconds, created_at, claimed_at, completed_at')
        .eq('company_id', selectedCompany.id)
        .eq('status', 'completed')
        .gte('completed_at', weekStart);

      let avgResponseMin = 0;
      let avgResolutionMin = 0;
      if (completedItems && completedItems.length > 0) {
        const responseTimes = completedItems
          .filter(i => i.claimed_at && i.created_at)
          .map(i => (new Date(i.claimed_at!).getTime() - new Date(i.created_at).getTime()) / 60000);
        const resolutionTimes = completedItems
          .filter(i => i.completed_at && i.created_at)
          .map(i => (new Date(i.completed_at!).getTime() - new Date(i.created_at).getTime()) / 60000);
        avgResponseMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
        avgResolutionMin = resolutionTimes.length > 0 ? Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) : 0;
      }

      // SLA compliance (items that were completed before deadline)
      const { data: slaItems } = await supabase
        .from('agent_queue')
        .select('sla_deadline, claimed_at')
        .eq('company_id', selectedCompany.id)
        .eq('status', 'completed')
        .not('sla_deadline', 'is', null)
        .gte('completed_at', weekStart);

      let slaCompliance = 100;
      if (slaItems && slaItems.length > 0) {
        const compliant = slaItems.filter(i => 
          i.claimed_at && new Date(i.claimed_at) <= new Date(i.sla_deadline!)
        ).length;
        slaCompliance = Math.round((compliant / slaItems.length) * 100);
      }

      // CSAT scores
      const { data: csatData } = await supabase
        .from('support_tickets')
        .select('satisfaction_score')
        .eq('company_id', selectedCompany.id)
        .gte('updated_at', weekStart)
        .gt('satisfaction_score', 0);

      let avgCsat = 0;
      if (csatData && csatData.length > 0) {
        avgCsat = +(csatData.reduce((a, b) => a + (b.satisfaction_score || 0), 0) / csatData.length).toFixed(1);
      }

      return {
        todayCount: todayCount || 0,
        weekCount: weekCount || 0,
        avgResponseMin,
        avgResolutionMin,
        slaCompliance,
        avgCsat,
        csatCount: csatData?.length || 0,
      };
    },
    enabled: !!selectedCompany?.id,
    refetchInterval: 60000,
  });

  const stats = {
    waiting: queueItems?.filter((i: any) => i.status === 'waiting').length || 0,
    active: queueItems?.filter((i: any) => ['assigned', 'active'].includes(i.status)).length || 0,
    completed: queueItems?.filter((i: any) => i.status === 'completed').length || 0,
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to access the Agent Workspace
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left: Queue List */}
      <div className="w-[400px] border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Headset className="h-5 w-5 text-primary" />
            Agent Workspace
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.waiting} waiting · {stats.active} active
          </p>
        </div>

        <Tabs defaultValue="queue" className="flex-1 flex flex-col">
          <TabsList className="mx-3 mt-2 h-8">
            <TabsTrigger value="queue" className="text-xs h-7">Queue</TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs h-7">
              <BarChart3 className="h-3 w-3 mr-1" />
              Metrics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="flex-1 flex flex-col mt-0">
            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2 p-3">
              <Card className="p-2 text-center cursor-pointer" onClick={() => setStatusFilter('waiting')}>
                <div className="text-lg font-bold text-amber-500">{stats.waiting}</div>
                <div className="text-[10px] text-muted-foreground">Waiting</div>
              </Card>
              <Card className="p-2 text-center cursor-pointer" onClick={() => setStatusFilter('all')}>
                <div className="text-lg font-bold text-blue-500">{stats.active}</div>
                <div className="text-[10px] text-muted-foreground">Active</div>
              </Card>
              <Card className="p-2 text-center cursor-pointer" onClick={() => setStatusFilter('completed')}>
                <div className="text-lg font-bold text-green-500">{stats.completed}</div>
                <div className="text-[10px] text-muted-foreground">Done</div>
              </Card>
            </div>

            {/* Filter */}
            <div className="px-3 pb-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="waiting">Waiting</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Queue Items */}
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
                ) : (queueItems || []).length === 0 ? (
                  <div className="text-center py-8">
                    <Headset className="h-10 w-10 mx-auto text-muted-foreground/20 mb-2" />
                    <p className="text-sm text-muted-foreground">No items in queue</p>
                  </div>
                ) : (
                  (queueItems || []).map((item: any) => (
                    <Card
                      key={item.id}
                      className={`p-3 cursor-pointer transition-colors hover:border-primary/30 ${
                        selectedItem?.id === item.id ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-medium text-sm truncate">{item.customer_name || 'Unknown'}</span>
                        <SLACountdown deadline={item.sla_deadline} />
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{item.ai_summary || 'No summary'}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className={`text-[10px] ${priorityConfig[item.priority]?.color || ''}`}>
                          {item.priority}
                        </Badge>
                        <Badge className={`text-[10px] ${statusConfig[item.status]?.color || ''}`}>
                          {statusConfig[item.status]?.label || item.status}
                        </Badge>
                        {item.department && (
                          <Badge variant="outline" className="text-[10px]">
                            <Building2 className="h-2.5 w-2.5 mr-0.5" />
                            {item.department}
                          </Badge>
                        )}
                      </div>
                      {item.status === 'waiting' && (
                        <Button
                          size="sm"
                          className="w-full mt-2 h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); claimMutation.mutate(item.id); }}
                          disabled={claimMutation.isPending}
                        >
                          <Zap className="h-3 w-3" />
                          Claim
                        </Button>
                      )}
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="metrics" className="flex-1 mt-0 overflow-auto">
            <div className="p-3 space-y-3">
              <Card className="p-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Tickets Resolved
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-2xl font-bold">{performanceData?.todayCount ?? '—'}</div>
                    <div className="text-[10px] text-muted-foreground">Today</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{performanceData?.weekCount ?? '—'}</div>
                    <div className="text-[10px] text-muted-foreground">This Week</div>
                  </div>
                </div>
              </Card>

              <Card className="p-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Response Times
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-2xl font-bold">{performanceData?.avgResponseMin ?? '—'}<span className="text-sm font-normal text-muted-foreground">m</span></div>
                    <div className="text-[10px] text-muted-foreground">Avg First Response</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{performanceData?.avgResolutionMin ?? '—'}<span className="text-sm font-normal text-muted-foreground">m</span></div>
                    <div className="text-[10px] text-muted-foreground">Avg Resolution</div>
                  </div>
                </div>
              </Card>

              <Card className="p-3">
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Target className="h-3 w-3" /> SLA & CSAT
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={`text-2xl font-bold ${
                      (performanceData?.slaCompliance ?? 100) >= 90 ? 'text-green-600' :
                      (performanceData?.slaCompliance ?? 100) >= 70 ? 'text-amber-500' : 'text-destructive'
                    }`}>
                      {performanceData?.slaCompliance ?? '—'}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">SLA Compliance</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{performanceData?.avgCsat || '—'}<span className="text-sm font-normal text-muted-foreground">/5</span></div>
                    <div className="text-[10px] text-muted-foreground">CSAT ({performanceData?.csatCount ?? 0} reviews)</div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Right: Detail View */}
      <div className="flex-1 flex flex-col">
        {!selectedItem ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm">Select a queue item to view details</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{selectedItem.customer_name || 'Unknown'}</span>
                  {selectedItem.customer_phone && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" />{selectedItem.customer_phone}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={priorityConfig[selectedItem.priority]?.color || ''}>
                    {selectedItem.priority}
                  </Badge>
                  <Badge className={statusConfig[selectedItem.status]?.color || ''}>
                    {statusConfig[selectedItem.status]?.label}
                  </Badge>
                  <SLACountdown deadline={selectedItem.sla_deadline} />
                </div>
              </div>
              <div className="flex gap-2">
                {selectedItem.status !== 'completed' && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1"
                    onClick={() => resolveMutation.mutate(selectedItem.id)}
                    disabled={resolveMutation.isPending}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Resolve
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Conversation */}
              <div className="flex-1 flex flex-col">
                <div className="p-3 border-b border-border bg-muted/30">
                  <h3 className="text-sm font-medium flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Conversation
                  </h3>
                </div>
                <ScrollArea className="flex-1 p-4">
                  {(messages || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No messages</p>
                  ) : (
                    <div className="space-y-3">
                      {(messages || []).map((msg: any) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                        >
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === 'user'
                              ? 'bg-muted text-foreground'
                              : 'bg-primary text-primary-foreground'
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            <span className="text-[10px] opacity-60 mt-1 block">
                              {new Date(msg.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                {/* Reply box */}
                <div className="p-3 border-t border-border">
                  <div className="flex gap-2">
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type a reply..."
                      className="min-h-[60px] resize-none text-sm"
                    />
                    <Button 
                      size="icon" 
                      className="h-[60px] w-10 flex-shrink-0" 
                      disabled={!replyText.trim() || sendReplyMutation.isPending || !selectedItem?.conversation_id}
                      onClick={() => {
                        if (replyText.trim() && selectedItem?.conversation_id) {
                          sendReplyMutation.mutate({ 
                            conversationId: selectedItem.conversation_id, 
                            message: replyText.trim() 
                          });
                        }
                      }}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Right Sidebar: AI Suggestions + Notes */}
              <div className="w-[280px] border-l border-border flex flex-col">
                {/* AI Suggestions */}
                <div className="p-3 border-b border-border">
                  <h3 className="text-sm font-medium flex items-center gap-1 mb-2">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    AI Suggestions
                  </h3>
                  {selectedItem.ai_suggested_responses?.length > 0 ? (
                    <div className="space-y-2">
                      {(selectedItem.ai_suggested_responses as any[]).map((suggestion: any, i: number) => (
                        <Card
                          key={i}
                          className="p-2 cursor-pointer hover:border-primary/30 transition-colors"
                          onClick={() => setReplyText(typeof suggestion === 'string' ? suggestion : suggestion.text || JSON.stringify(suggestion))}
                        >
                          <p className="text-xs line-clamp-3">
                            {typeof suggestion === 'string' ? suggestion : suggestion.text || JSON.stringify(suggestion)}
                          </p>
                          <span className="text-[10px] text-muted-foreground mt-1 block">Click to use</span>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No AI suggestions available</p>
                  )}
                </div>

                {/* AI Summary */}
                {selectedItem.ai_summary && (
                  <div className="p-3 border-b border-border">
                    <h3 className="text-sm font-medium mb-1">Summary</h3>
                    <p className="text-xs text-muted-foreground">{selectedItem.ai_summary}</p>
                  </div>
                )}

                {/* Internal Notes */}
                <div className="flex-1 flex flex-col">
                  <div className="p-3 border-b border-border">
                    <h3 className="text-sm font-medium flex items-center gap-1">
                      <StickyNote className="h-3.5 w-3.5" />
                      Internal Notes
                    </h3>
                  </div>
                  <ScrollArea className="flex-1 p-3">
                    <div className="space-y-2">
                      {(notes || []).map((note: any) => (
                        <div key={note.id} className="bg-muted/50 rounded p-2">
                          <p className="text-xs">{note.content}</p>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(note.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  {selectedItem.ticket_id && (
                    <div className="p-3 border-t border-border">
                      <div className="flex gap-1">
                        <Input
                          value={noteContent}
                          onChange={(e) => setNoteContent(e.target.value)}
                          placeholder="Add note..."
                          className="h-8 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && noteContent.trim()) {
                              addNoteMutation.mutate({ ticketId: selectedItem.ticket_id, content: noteContent });
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          disabled={!noteContent.trim() || addNoteMutation.isPending}
                          onClick={() => {
                            if (noteContent.trim()) {
                              addNoteMutation.mutate({ ticketId: selectedItem.ticket_id, content: noteContent });
                            }
                          }}
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
