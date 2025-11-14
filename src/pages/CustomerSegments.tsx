import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, TrendingUp, Target, Zap, RefreshCw } from "lucide-react";
import Sidebar from "@/components/Sidebar";

interface CustomerSegment {
  id: string;
  customer_phone: string;
  customer_name: string;
  engagement_score: number;
  engagement_level: string;
  intent_category: string;
  intent_score: number;
  conversion_potential: string;
  conversion_score: number;
  segment_type: string;
  total_conversations: number;
  has_reservation: boolean;
  has_payment: boolean;
  total_spend: number;
  last_interaction_at: string;
  analysis_notes: string;
  detected_interests: string[];
}

export default function CustomerSegments() {
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
    loadSegments();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login");
    }
  };

  const loadSegments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('customer_segments')
        .select('*')
        .order('conversion_score', { ascending: false });

      if (error) throw error;
      setSegments(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading segments",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const analyzeCustomers = async () => {
    try {
      setAnalyzing(true);
      const { data, error } = await supabase.functions.invoke('segment-customers');
      
      if (error) throw error;
      
      toast({
        title: "Analysis Complete",
        description: data.message,
      });
      
      await loadSegments();
    } catch (error: any) {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getSegmentColor = (type: string) => {
    const colors: any = {
      vip_customer: "bg-purple-500",
      active_customer: "bg-green-500",
      hot_lead: "bg-red-500",
      warm_lead: "bg-orange-500",
      cold_lead: "bg-blue-500",
      at_risk: "bg-yellow-500",
      dormant: "bg-gray-500",
      lost: "bg-gray-400",
    };
    return colors[type] || "bg-gray-500";
  };

  const getEngagementColor = (level: string) => {
    return level === 'high' ? 'text-green-600' : 
           level === 'medium' ? 'text-yellow-600' : 
           'text-gray-600';
  };

  const filteredSegments = segments.filter(seg => {
    if (activeTab === "all") return true;
    if (activeTab === "hot") return seg.segment_type === "hot_lead" || seg.segment_type === "warm_lead";
    if (activeTab === "customers") return seg.segment_type === "active_customer" || seg.segment_type === "vip_customer";
    if (activeTab === "risk") return seg.segment_type === "at_risk" || seg.segment_type === "dormant";
    return false;
  });

  const stats = {
    total: segments.length,
    hot: segments.filter(s => s.segment_type === "hot_lead" || s.segment_type === "warm_lead").length,
    customers: segments.filter(s => s.segment_type === "active_customer" || s.segment_type === "vip_customer").length,
    atRisk: segments.filter(s => s.segment_type === "at_risk" || s.segment_type === "dormant").length,
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-foreground">Customer Segmentation</h1>
              <p className="text-muted-foreground mt-2">Analyze engagement, intent, and conversion potential</p>
            </div>
            <Button 
              onClick={analyzeCustomers} 
              disabled={analyzing}
              size="lg"
            >
              {analyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Analyze Customers
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Customers</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <Zap className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Hot Leads</p>
                  <p className="text-2xl font-bold text-foreground">{stats.hot}</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <Target className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Customers</p>
                  <p className="text-2xl font-bold text-foreground">{stats.customers}</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">At Risk</p>
                  <p className="text-2xl font-bold text-foreground">{stats.atRisk}</p>
                </div>
              </div>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
              <TabsTrigger value="hot">Hot Leads ({stats.hot})</TabsTrigger>
              <TabsTrigger value="customers">Customers ({stats.customers})</TabsTrigger>
              <TabsTrigger value="risk">At Risk ({stats.atRisk})</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="space-y-4 mt-6">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredSegments.length === 0 ? (
                <Card className="p-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Segments Found</h3>
                  <p className="text-muted-foreground mb-6">Click "Analyze Customers" to segment your customer base</p>
                  <Button onClick={analyzeCustomers} disabled={analyzing}>
                    {analyzing ? "Analyzing..." : "Analyze Now"}
                  </Button>
                </Card>
              ) : (
                filteredSegments.map((segment) => (
                  <Card key={segment.id} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-lg font-semibold text-foreground">
                            {segment.customer_name || "Unknown Customer"}
                          </h3>
                          <Badge className={getSegmentColor(segment.segment_type)}>
                            {segment.segment_type.replace(/_/g, ' ').toUpperCase()}
                          </Badge>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-4">{segment.customer_phone}</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Engagement</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-muted rounded-full h-2">
                                <div 
                                  className="bg-primary h-2 rounded-full transition-all"
                                  style={{ width: `${segment.engagement_score}%` }}
                                />
                              </div>
                              <span className={`text-sm font-semibold ${getEngagementColor(segment.engagement_level)}`}>
                                {segment.engagement_score}%
                              </span>
                            </div>
                          </div>
                          
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Intent</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-muted rounded-full h-2">
                                <div 
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${segment.intent_score}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-foreground">{segment.intent_score}%</span>
                            </div>
                          </div>
                          
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Conversion Potential</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-muted rounded-full h-2">
                                <div 
                                  className="bg-green-500 h-2 rounded-full transition-all"
                                  style={{ width: `${segment.conversion_score}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-foreground">{segment.conversion_score}%</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-2 mb-3">
                          <Badge variant="outline">
                            {segment.total_conversations} conversations
                          </Badge>
                          {segment.has_reservation && (
                            <Badge variant="outline" className="bg-green-500/10">
                              Has Reservation
                            </Badge>
                          )}
                          {segment.has_payment && (
                            <Badge variant="outline" className="bg-purple-500/10">
                              K{segment.total_spend.toFixed(2)} spent
                            </Badge>
                          )}
                          {segment.detected_interests?.map((interest) => (
                            <Badge key={interest} variant="secondary">
                              {interest}
                            </Badge>
                          ))}
                        </div>
                        
                        <p className="text-sm text-muted-foreground">{segment.analysis_notes}</p>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
