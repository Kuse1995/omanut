import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';

interface CreditUsage {
  id: string;
  amount_used: number;
  reason: string;
  created_at: string;
}

const Billing = () => {
  const { toast } = useToast();
  const [creditBalance, setCreditBalance] = useState(0);
  const [usage, setUsage] = useState<CreditUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBillingData();
  }, []);

  const fetchBillingData = async () => {
    try {
      // Get first company (in production, filter by user's company_id)
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .limit(1)
        .single();

      setCreditBalance(company?.credit_balance || 0);

      // Get credit usage history
      const { data: usageData } = await supabase
        .from('credit_usage')
        .select('*')
        .eq('company_id', company?.id)
        .order('created_at', { ascending: false })
        .limit(10);

      setUsage(usageData || []);
    } catch (error) {
      console.error('Error fetching billing data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load billing data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCredits = () => {
    toast({
      title: 'Coming Soon',
      description: 'Credit top-up feature will be available soon. Contact support for manual credits.',
    });
  };

  return (
    <div className="min-h-screen bg-app p-8">
      <div className="max-w-5xl mx-auto">
        <BackButton />
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gradient mb-2">Billing & Credits</h1>
          <p className="text-muted-foreground">Manage your credit balance and view usage history</p>
        </div>

        <div className="grid gap-6 mb-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Current Balance
              </CardTitle>
              <CardDescription>Available credits for AI receptionist calls</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-4xl font-bold text-gradient">
                    {loading ? '...' : creditBalance}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">credits remaining</p>
                </div>
                <Button onClick={handleAddCredits} className="bg-primary hover:bg-primary/90">
                  Add Credits
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="card-glass">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-accent" />
              Usage History
            </CardTitle>
            <CardDescription>Recent credit deductions</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : usage.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No usage history yet</div>
            ) : (
              <div className="space-y-3">
                {usage.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-md bg-muted/20 hover:bg-muted/30 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-foreground capitalize">
                        {item.reason.replace('_', ' ')}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-lg font-semibold text-destructive">
                      -{item.amount_used}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 p-4 rounded-lg bg-muted/20 border border-muted">
          <h3 className="font-semibold text-foreground mb-2">Credit Pricing</h3>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>• Call start: 5 credits</p>
            <p>• Per minute of conversation: varies by usage</p>
            <p>• Low balance threshold: 100 credits</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Billing;