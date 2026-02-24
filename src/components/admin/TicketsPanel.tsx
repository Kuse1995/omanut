import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Ticket, Search, Filter, Clock, CheckCircle, AlertTriangle, User, Building2, MessageSquare } from 'lucide-react';
import { DepartmentManager } from './DepartmentManager';

const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-primary/10 text-primary',
  high: 'bg-destructive/10 text-destructive',
  urgent: 'bg-destructive text-destructive-foreground',
};

const statusColors: Record<string, string> = {
  open: 'bg-primary/10 text-primary',
  in_progress: 'bg-accent text-accent-foreground',
  waiting: 'bg-muted text-muted-foreground',
  resolved: 'bg-green-500/10 text-green-600',
  closed: 'bg-muted text-muted-foreground',
};

export const TicketsPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('tickets');

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['support-tickets', selectedCompany?.id, statusFilter, priorityFilter],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      let query = supabase
        .from('support_tickets')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (priorityFilter !== 'all') query = query.eq('priority', priorityFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany?.id,
  });

  const updateTicketMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast({ title: 'Ticket updated' });
    },
  });

  const filteredTickets = (tickets || []).filter((t: any) =>
    !searchQuery || 
    t.ticket_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.issue_summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    open: tickets?.filter((t: any) => t.status === 'open').length || 0,
    in_progress: tickets?.filter((t: any) => t.status === 'in_progress').length || 0,
    resolved: tickets?.filter((t: any) => t.status === 'resolved').length || 0,
    urgent: tickets?.filter((t: any) => t.priority === 'urgent' && t.status !== 'closed').length || 0,
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to view support tickets
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Ticket className="h-6 w-6 text-primary" />
            Support Tickets
          </h2>
          <p className="text-muted-foreground text-sm">Manage customer issues and track resolutions</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-sm text-muted-foreground">Open</div>
              <div className="text-2xl font-bold text-primary">{stats.open}</div>
            </Card>
            <Card className="p-3">
              <div className="text-sm text-muted-foreground">In Progress</div>
              <div className="text-2xl font-bold">{stats.in_progress}</div>
            </Card>
            <Card className="p-3">
              <div className="text-sm text-muted-foreground">Resolved</div>
              <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
            </Card>
            <Card className="p-3">
              <div className="text-sm text-muted-foreground">Urgent</div>
              <div className="text-2xl font-bold text-destructive">{stats.urgent}</div>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Ticket List */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <Card className="p-8 text-center">
              <Ticket className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No tickets found</p>
              <p className="text-xs text-muted-foreground mt-1">Tickets are created automatically by the AI during WhatsApp conversations</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredTickets.map((ticket: any) => (
                <Card
                  key={ticket.id}
                  className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-medium text-primary">{ticket.ticket_number}</span>
                        <Badge className={priorityColors[ticket.priority] || ''}>{ticket.priority}</Badge>
                        <Badge className={statusColors[ticket.status] || ''}>{ticket.status.replace('_', ' ')}</Badge>
                        <Badge variant="outline">{ticket.issue_category}</Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{ticket.issue_summary}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" />{ticket.customer_name || 'Unknown'}</span>
                        {ticket.recommended_department && (
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{ticket.recommended_department}</span>
                        )}
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(ticket.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentManager companyId={selectedCompany.id} />
        </TabsContent>
      </Tabs>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              {selectedTicket?.ticket_number}
            </DialogTitle>
          </DialogHeader>
          {selectedTicket && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge className={priorityColors[selectedTicket.priority]}>{selectedTicket.priority}</Badge>
                <Badge className={statusColors[selectedTicket.status]}>{selectedTicket.status.replace('_', ' ')}</Badge>
                <Badge variant="outline">{selectedTicket.issue_category}</Badge>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Customer</label>
                <p className="text-sm">{selectedTicket.customer_name} · {selectedTicket.customer_phone}</p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Issue</label>
                <p className="text-sm">{selectedTicket.issue_summary}</p>
              </div>

              {selectedTicket.recommended_department && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">AI Recommended Department</label>
                  <p className="text-sm flex items-center gap-1"><Building2 className="h-3 w-3" />{selectedTicket.recommended_department}</p>
                </div>
              )}

              {selectedTicket.service_recommendations?.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">AI Service Recommendations</label>
                  <ul className="text-sm list-disc list-inside">
                    {selectedTicket.service_recommendations.map((r: string, i: number) => (
                      <li key={i}>{typeof r === 'string' ? r : JSON.stringify(r)}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Select
                  value={selectedTicket.status}
                  onValueChange={(val) => {
                    updateTicketMutation.mutate({
                      id: selectedTicket.id,
                      updates: { status: val, ...(val === 'resolved' ? { resolved_at: new Date().toISOString() } : {}) }
                    });
                    setSelectedTicket({ ...selectedTicket, status: val });
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="waiting">Waiting</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Assign To</label>
                <Input
                  placeholder="Department or employee name"
                  defaultValue={selectedTicket.assigned_to || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedTicket.assigned_to || '')) {
                      updateTicketMutation.mutate({
                        id: selectedTicket.id,
                        updates: { assigned_to: e.target.value }
                      });
                    }
                  }}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Resolution Notes</label>
                <Textarea
                  placeholder="How was this resolved?"
                  defaultValue={selectedTicket.resolution_notes || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedTicket.resolution_notes || '')) {
                      updateTicketMutation.mutate({
                        id: selectedTicket.id,
                        updates: { resolution_notes: e.target.value }
                      });
                    }
                  }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
