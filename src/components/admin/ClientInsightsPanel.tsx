import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, Info, Star } from 'lucide-react';
import { toast } from 'sonner';

export const ClientInsightsPanel = () => {
  const { selectedCompany } = useCompany();
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<any[]>([]);
  const [stats, setStats] = useState({ pending: 0, urgent: 0, completed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    
    fetchData();

    const actionChannel = supabase
      .channel('action-items-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_items' },
        () => fetchData()
      )
      .subscribe();

    const infoChannel = supabase
      .channel('client-info-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_information' },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(actionChannel);
      supabase.removeChannel(infoChannel);
    };
  }, [selectedCompany?.id]);

  const fetchData = async () => {
    if (!selectedCompany?.id) return;

    setLoading(true);

    const { data: actions } = await supabase
      .from('action_items')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('created_at', { ascending: false });

    setActionItems(actions || []);
    
    const pending = actions?.filter(a => a.status === 'pending').length || 0;
    const urgent = actions?.filter(a => a.priority === 'urgent').length || 0;
    const completed = actions?.filter(a => a.status === 'completed').length || 0;
    setStats({ pending, urgent, completed });

    const { data: info } = await supabase
      .from('client_information')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('created_at', { ascending: false });

    setClientInfo(info || []);
    setLoading(false);
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
      toast.error('Failed to update action item');
    } else {
      toast.success('Action item updated');
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'high': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'medium': return <Info className="h-4 w-4 text-[#84CC16]" />;
      default: return <Clock className="h-4 w-4 text-white/40" />;
    }
  };

  const getImportanceIcon = (importance: string) => {
    return importance === 'high' 
      ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
      : <Info className="h-4 w-4 text-white/40" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Loading insights...</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">Pending Actions</CardTitle>
              <Clock className="h-4 w-4 text-white/60" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">Urgent Items</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{stats.urgent}</div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">Completed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-[#84CC16]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#84CC16]">{stats.completed}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Action Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/60">Priority</TableHead>
                  <TableHead className="text-white/60">Customer</TableHead>
                  <TableHead className="text-white/60">Action</TableHead>
                  <TableHead className="text-white/60">Description</TableHead>
                  <TableHead className="text-white/60">Status</TableHead>
                  <TableHead className="text-white/60">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionItems.length === 0 ? (
                  <TableRow className="border-white/10">
                    <TableCell colSpan={6} className="text-center text-white/60">
                      No action items yet
                    </TableCell>
                  </TableRow>
                ) : (
                  actionItems.map((item) => (
                    <TableRow key={item.id} className="border-white/10">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getPriorityIcon(item.priority)}
                          <span className="capitalize text-white">{item.priority}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-white font-medium">{item.customer_name || 'Unknown'}</div>
                        <div className="text-sm text-white/60">{item.customer_phone}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize border-white/20 text-white">
                          {item.action_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white">{item.description}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={item.status === 'completed' ? 'default' : 'outline'}
                          className={item.status === 'completed' ? 'bg-[#84CC16] text-black' : 'border-white/20 text-white'}
                        >
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
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              Start
                            </Button>
                          )}
                          {item.status === 'in_progress' && (
                            <Button
                              size="sm"
                              onClick={() => updateActionStatus(item.id, 'completed')}
                              className="bg-[#84CC16] text-black hover:bg-[#84CC16]/90"
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

        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Client Information</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/60">Importance</TableHead>
                  <TableHead className="text-white/60">Customer</TableHead>
                  <TableHead className="text-white/60">Type</TableHead>
                  <TableHead className="text-white/60">Information</TableHead>
                  <TableHead className="text-white/60">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientInfo.length === 0 ? (
                  <TableRow className="border-white/10">
                    <TableCell colSpan={5} className="text-center text-white/60">
                      No client information yet
                    </TableCell>
                  </TableRow>
                ) : (
                  clientInfo.map((info) => (
                    <TableRow key={info.id} className="border-white/10">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getImportanceIcon(info.importance)}
                          <span className="capitalize text-white">{info.importance}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-white font-medium">{info.customer_name || 'Unknown'}</div>
                        <div className="text-sm text-white/60">{info.customer_phone}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize border-white/20 text-white">
                          {info.info_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white">{info.information}</TableCell>
                      <TableCell className="text-white/60">
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
    </ScrollArea>
  );
};
