import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditCard, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export const BillingPanel = () => {
  const { selectedCompany } = useCompany();
  const [creditUsage, setCreditUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditsToAdd, setCreditsToAdd] = useState('');
  const [retryingMedia, setRetryingMedia] = useState(false);

  useEffect(() => {
    if (!selectedCompany?.id) return;

    fetchCreditUsage();

    const channel = supabase
      .channel('credit-usage-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'credit_usage' },
        () => fetchCreditUsage()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCompany?.id]);

  const fetchCreditUsage = async () => {
    if (!selectedCompany?.id) return;

    setLoading(true);

    const { data } = await supabase
      .from('credit_usage')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('created_at', { ascending: false })
      .limit(50);

    setCreditUsage(data || []);
    setLoading(false);
  };

  const handleAddCredits = async () => {
    if (!selectedCompany?.id || !creditsToAdd) return;

    const amount = parseInt(creditsToAdd);
    if (isNaN(amount) || amount <= 0 || amount > 1000000) {
      toast.error('Please enter a valid amount (1 – 1,000,000)');
      return;
    }

    const { error } = await supabase.rpc('add_credits', {
      p_company_id: selectedCompany.id,
      p_amount: amount,
      p_reason: 'Manual credit addition by admin'
    });

    if (error) {
      toast.error(`Failed to add credits: ${error.message}`);
    } else {
      toast.success(`Added ${amount} credits`);
      setCreditsToAdd('');
      window.location.reload();
    }
  };

  const handleRetryFailedMedia = async () => {
    setRetryingMedia(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('retry-failed-media');
      
      if (error) throw error;
      
      if (data) {
        toast.success(
          `Retry processing complete: ${data.success} succeeded, ${data.failed} failed, ${data.skipped} skipped`,
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Error retrying media:', error);
      toast.error('Failed to retry media deliveries');
    } finally {
      setRetryingMedia(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Loading billing information...</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Current Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-[#84CC16] mb-4">
              {selectedCompany?.credit_balance || 0} credits
            </div>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="credits" className="text-white/60">Add Credits</Label>
                <Input
                  id="credits"
                  type="number"
                  placeholder="Enter amount"
                  min={1}
                  max={1000000}
                  value={creditsToAdd}
                  onChange={(e) => setCreditsToAdd(e.target.value)}
                  className="bg-[#0A0A0A] border-white/20 text-white"
                />
              </div>
              <Button 
                onClick={handleAddCredits}
                className="bg-[#84CC16] text-black hover:bg-[#84CC16]/90"
              >
                Add Credits
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Media Delivery Retries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-white/60 mb-4">
              Manually trigger retry attempts for failed media deliveries. The system uses exponential backoff (2, 4, 8, 16, 32 minutes) with a maximum of 5 retry attempts.
            </p>
            <Button 
              onClick={handleRetryFailedMedia}
              disabled={retryingMedia}
              className="bg-[#84CC16] text-black hover:bg-[#84CC16]/90"
            >
              {retryingMedia ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing Retries...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Failed Media Deliveries
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Credit Usage History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/60">Date</TableHead>
                  <TableHead className="text-white/60">Amount</TableHead>
                  <TableHead className="text-white/60">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditUsage.length === 0 ? (
                  <TableRow className="border-white/10">
                    <TableCell colSpan={3} className="text-center text-white/60">
                      No credit usage history yet
                    </TableCell>
                  </TableRow>
                ) : (
                  creditUsage.map((usage) => (
                    <TableRow key={usage.id} className="border-white/10">
                      <TableCell className="text-white">
                        {new Date(usage.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className={usage.amount_used > 0 ? 'text-red-500' : 'text-[#84CC16]'}>
                        {usage.amount_used > 0 ? '-' : '+'}{Math.abs(usage.amount_used)}
                      </TableCell>
                      <TableCell className="text-white/60">{usage.reason}</TableCell>
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
