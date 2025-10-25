import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle2, Clock, Info, Star } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';

const ClientInsights = () => {
  const { toast } = useToast();
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<any[]>([]);
  const [stats, setStats] = useState({ pending: 0, urgent: 0, completed: 0 });
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (!userData?.company_id) return;
    setCompanyId(userData.company_id);

    // Fetch action items
    const { data: actions, error: actionsError } = await supabase
      .from('action_items')
      .select('*')
      .eq('company_id', userData.company_id)
      .order('created_at', { ascending: false });

    if (actionsError) {
      console.error('Error fetching action items:', actionsError);
    } else {
      setActionItems(actions || []);
      
      const pending = actions?.filter(a => a.status === 'pending').length || 0;
      const urgent = actions?.filter(a => a.priority === 'urgent').length || 0;
      const completed = actions?.filter(a => a.status === 'completed').length || 0;
      setStats({ pending, urgent, completed });
    }

    // Fetch client information
    const { data: info, error: infoError } = await supabase
      .from('client_information')
      .select('*')
      .eq('company_id', userData.company_id)
      .order('created_at', { ascending: false });

    if (infoError) {
      console.error('Error fetching client info:', infoError);
    } else {
      setClientInfo(info || []);
    }
  };

  const updateActionStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from('action_items')
      .update({ 
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null
      })
      .eq('id', id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update action item",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Action item updated",
      });
      fetchData();
    }
  };

  const analyzeRecentConversations = async () => {
    if (!companyId) return;
    
    setAnalyzing(true);
    try {
      // Get recent conversations without analysis
      const { data: conversations, error: convError } = await supabase
        .from('conversations')
        .select('id, transcript, status')
        .eq('company_id', companyId)
        .eq('status', 'completed')
        .not('transcript', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(10);

      if (convError) throw convError;

      if (!conversations || conversations.length === 0) {
        toast({
          title: "No conversations to analyze",
          description: "There are no completed conversations with transcripts",
        });
        return;
      }

      // Analyze each conversation
      let analyzed = 0;
      for (const conv of conversations) {
        const { error } = await supabase.functions.invoke('analyze-conversation', {
          body: { conversation_id: conv.id }
        });
        
        if (!error) analyzed++;
      }

      toast({
        title: "Analysis complete",
        description: `Analyzed ${analyzed} conversation${analyzed !== 1 ? 's' : ''}`,
      });

      // Refresh data
      fetchData();
    } catch (error: any) {
      console.error('Error analyzing conversations:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to analyze conversations",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'high': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'medium': return <Info className="h-4 w-4 text-primary" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getImportanceIcon = (importance: string) => {
    switch (importance) {
      case 'high': return <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />;
      default: return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="p-8 space-y-8">
      <BackButton />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Client Insights & Action Items</h1>
          <p className="text-muted-foreground">Important information and follow-ups from customer interactions</p>
        </div>
        <Button onClick={analyzeRecentConversations} disabled={analyzing}>
          {analyzing ? "Analyzing..." : "Analyze Recent Conversations"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Actions</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Tasks to complete</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Urgent Items</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.urgent}</div>
            <p className="text-xs text-muted-foreground">Needs immediate attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">Tasks finished</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Action Items & Reminders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actionItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No action items yet. The AI will automatically create reminders from conversations.
                  </TableCell>
                </TableRow>
              ) : (
                actionItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getPriorityIcon(item.priority)}
                        <span className="capitalize">{item.priority}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{item.customer_name || 'Unknown'}</div>
                        <div className="text-sm text-muted-foreground">{item.customer_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {item.action_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{item.description}</TableCell>
                    <TableCell>
                      <Badge variant={
                        item.status === 'completed' ? 'default' :
                        item.status === 'in_progress' ? 'secondary' :
                        'outline'
                      }>
                        {item.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {item.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateActionStatus(item.id, 'in_progress')}
                          >
                            Start
                          </Button>
                        )}
                        {item.status === 'in_progress' && (
                          <Button
                            size="sm"
                            onClick={() => updateActionStatus(item.id, 'completed')}
                          >
                            Complete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client Information Database</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Importance</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Information</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientInfo.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No client information stored yet. The AI will automatically extract and organize important details from conversations.
                  </TableCell>
                </TableRow>
              ) : (
                clientInfo.map((info) => (
                  <TableRow key={info.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getImportanceIcon(info.importance)}
                        <span className="capitalize">{info.importance}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{info.customer_name || 'Unknown'}</div>
                        <div className="text-sm text-muted-foreground">{info.customer_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {info.info_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{info.information}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(info.created_at).toLocaleDateString()}
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

export default ClientInsights;