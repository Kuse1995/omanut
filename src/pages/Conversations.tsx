import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Search, Eye } from 'lucide-react';
import BackButton from '@/components/BackButton';
import ConversationDetailsDialog from '@/components/ConversationDetailsDialog';

const Conversations = () => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, avgDuration: 0 });
  const [selectedConversation, setSelectedConversation] = useState<any>(null);
  const [conversationDetails, setConversationDetails] = useState<{clientInfo: any[], actionItems: any[]}>({
    clientInfo: [],
    actionItems: []
  });
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  useEffect(() => {
    fetchConversations();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        () => fetchConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchConversations = async () => {
    // Get current user's company
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (!userData?.company_id) return;

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', userData.company_id)
      .order('started_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error);
      return;
    }

    setConversations(data || []);

    // Calculate stats
    const total = data?.length || 0;
    const active = data?.filter(c => c.status === 'active').length || 0;
    const completed = data?.filter(c => c.duration_seconds) || [];
    const avgDuration = completed.length > 0
      ? Math.round(completed.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / completed.length)
      : 0;

    setStats({ total, active, avgDuration });
  };

  const filteredConversations = conversations.filter(conv =>
    conv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    conv.phone?.includes(search)
  );

  const viewConversationDetails = async (conversation: any) => {
    setSelectedConversation(conversation);
    
    // Fetch related client info and action items
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const [clientInfoResult, actionItemsResult] = await Promise.all([
      supabase
        .from('client_information')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('action_items')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
    ]);

    setConversationDetails({
      clientInfo: clientInfoResult.data || [],
      actionItems: actionItemsResult.data || []
    });
    setDetailsDialogOpen(true);
  };

  return (
    <div className="p-8 space-y-8 bg-app min-h-screen animate-fade-in">
      <BackButton />
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="text-gradient">Conversations</span>
        </h1>
        <p className="text-lg text-muted-foreground">All customer interactions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Now</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgDuration}s</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transcript</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredConversations.map((conv) => (
                <TableRow key={conv.id}>
                  <TableCell className="font-medium">{conv.customer_name || 'Unknown'}</TableCell>
                  <TableCell>{conv.phone || 'N/A'}</TableCell>
                  <TableCell>
                    {new Date(conv.started_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {conv.duration_seconds ? `${conv.duration_seconds}s` : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={conv.status === 'active' ? 'default' : 'secondary'}>
                      {conv.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {conv.transcript ? (
                      <Badge variant="outline" className="bg-accent-teal/10 text-accent-teal border-accent-teal/20">
                        Available
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="opacity-50">None</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewConversationDetails(conv)}
                      className="hover-glow"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConversationDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        conversation={selectedConversation}
        clientInfo={conversationDetails.clientInfo}
        actionItems={conversationDetails.actionItems}
      />
    </div>
  );
};

export default Conversations;