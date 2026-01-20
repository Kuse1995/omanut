import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Loader2, CheckCircle2, AlertCircle, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExtractedField {
  value: string;
  confidence: number;
  source_excerpt: string;
}

interface SmartConfigResult {
  extracted_fields: Record<string, ExtractedField>;
  optimization_suggestions: string[];
  summary: string;
  overall_confidence: number;
  fields_count: number;
}

interface SmartConfigurePanelProps {
  companyId: string;
  onConfigApplied?: () => void;
}

const FIELD_LABELS: Record<string, { label: string; description: string; table: string; column: string }> = {
  knowledge_base: { 
    label: "Knowledge Base", 
    description: "Products, prices, policies, FAQs",
    table: "companies",
    column: "quick_reference_info"
  },
  system_instructions: { 
    label: "System Instructions", 
    description: "Rules, protocols, escalation procedures",
    table: "company_ai_overrides",
    column: "system_instructions"
  },
  qa_style: { 
    label: "Response Style", 
    description: "Tone, personality, communication style",
    table: "company_ai_overrides",
    column: "qa_style"
  },
  banned_topics: { 
    label: "Banned Topics", 
    description: "Topics AI should avoid",
    table: "company_ai_overrides",
    column: "banned_topics"
  },
  hours: { 
    label: "Operating Hours", 
    description: "Business operating hours",
    table: "companies",
    column: "hours"
  },
  services: { 
    label: "Services", 
    description: "Main services/products offered",
    table: "companies",
    column: "services"
  },
  service_locations: { 
    label: "Service Locations", 
    description: "Areas within the business",
    table: "companies",
    column: "service_locations"
  },
  voice_style: { 
    label: "Voice Style", 
    description: "AI personality description",
    table: "companies",
    column: "voice_style"
  },
  business_type: { 
    label: "Business Type", 
    description: "Industry category",
    table: "companies",
    column: "business_type"
  },
};

export const SmartConfigurePanel = ({ companyId, onConfigApplied }: SmartConfigurePanelProps) => {
  const [overview, setOverview] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<SmartConfigResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  const handleSmartConfigure = async () => {
    if (!overview.trim()) {
      toast.error("Please enter a business overview");
      return;
    }

    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smart-configure`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            company_id: companyId,
            business_overview: overview
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Smart configuration failed');
      }

      setResult(data.data);
      // Pre-select all high-confidence fields
      const highConfidenceFields = new Set<string>();
      Object.entries(data.data.extracted_fields || {}).forEach(([key, field]: [string, any]) => {
        if (field.confidence >= 70) {
          highConfidenceFields.add(key);
        }
      });
      setSelectedFields(highConfidenceFields);
      setShowPreview(true);

    } catch (error: any) {
      console.error('Smart configure error:', error);
      toast.error(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const toggleExpand = (fieldKey: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const applySelectedFields = async () => {
    if (!result || selectedFields.size === 0) return;

    setIsApplying(true);
    try {
      // Group fields by table
      const companyUpdates: Record<string, string> = {};
      const aiOverrideUpdates: Record<string, string> = {};

      for (const fieldKey of selectedFields) {
        const fieldConfig = FIELD_LABELS[fieldKey];
        const fieldData = result.extracted_fields[fieldKey];
        if (!fieldConfig || !fieldData) continue;

        if (fieldConfig.table === 'companies') {
          companyUpdates[fieldConfig.column] = fieldData.value;
        } else if (fieldConfig.table === 'company_ai_overrides') {
          aiOverrideUpdates[fieldConfig.column] = fieldData.value;
        }
      }

      // Update companies table
      if (Object.keys(companyUpdates).length > 0) {
        const { error: companyError } = await supabase
          .from('companies')
          .update(companyUpdates)
          .eq('id', companyId);

        if (companyError) throw companyError;
      }

      // Update or insert AI overrides
      if (Object.keys(aiOverrideUpdates).length > 0) {
        const { data: existing } = await supabase
          .from('company_ai_overrides')
          .select('id')
          .eq('company_id', companyId)
          .single();

        if (existing) {
          const { error: overrideError } = await supabase
            .from('company_ai_overrides')
            .update(aiOverrideUpdates)
            .eq('company_id', companyId);

          if (overrideError) throw overrideError;
        } else {
          const { error: insertError } = await supabase
            .from('company_ai_overrides')
            .insert({
              company_id: companyId,
              ...aiOverrideUpdates
            });

          if (insertError) throw insertError;
        }
      }

      toast.success(`Applied ${selectedFields.size} configuration fields`);
      setShowPreview(false);
      setResult(null);
      setOverview("");
      onConfigApplied?.();

    } catch (error: any) {
      console.error('Error applying config:', error);
      toast.error(error.message || 'Failed to apply configuration');
    } finally {
      setIsApplying(false);
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 85) return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">High ({confidence}%)</Badge>;
    if (confidence >= 70) return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Medium ({confidence}%)</Badge>;
    return <Badge className="bg-red-500/10 text-red-600 border-red-500/20">Low ({confidence}%)</Badge>;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>Smart Configure</CardTitle>
          </div>
          <CardDescription>
            Paste a business overview, description, or any text about the company. The AI will automatically 
            extract and organize information into the appropriate configuration fields for optimal AI performance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            placeholder={`Paste any business information here. Examples:

"Welcome to Joe's Steakhouse! We're a family-owned restaurant serving premium steaks since 1985. 
Open Monday-Saturday 11am-10pm, closed Sundays. 

Menu highlights:
- Ribeye Steak: $45
- Filet Mignon: $55
- House Burger: $18

We accept reservations for parties of 4+. Cancellations must be made 24 hours in advance.
For large events, contact our events team. We don't discuss competitor pricing.
Our staff is trained to be warm, professional, and knowledgeable about wine pairings."

The AI will automatically:
✓ Extract menu items → Knowledge Base
✓ Identify hours → Operating Hours  
✓ Find policies → System Instructions
✓ Detect tone → Response Style
✓ Spot restrictions → Banned Topics`}
            className="min-h-[200px]"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {overview.length} characters
            </span>
            <Button 
              onClick={handleSmartConfigure}
              disabled={isProcessing || !overview.trim()}
              className="gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Smart Configure
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Configuration Preview
            </DialogTitle>
            <DialogDescription>
              {result && (
                <span className="flex items-center gap-2 mt-1">
                  Found {result.fields_count} fields • Overall confidence: {result.overall_confidence}%
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {result && (
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4">
                {/* Summary */}
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm">{result.summary}</p>
                </div>

                {/* Extracted Fields */}
                <div className="space-y-3">
                  {Object.entries(result.extracted_fields).map(([key, field]) => {
                    const config = FIELD_LABELS[key];
                    if (!config) return null;
                    
                    const isSelected = selectedFields.has(key);
                    const isExpanded = expandedFields.has(key);
                    const fieldData = field as ExtractedField;

                    return (
                      <div 
                        key={key}
                        className={`p-4 rounded-lg border transition-colors ${
                          isSelected ? 'bg-primary/5 border-primary/30' : 'bg-muted/30 border-border'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleField(key)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{config.label}</span>
                                {getConfidenceBadge(fieldData.confidence)}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {config.description}
                              </p>
                              
                              {/* Value preview */}
                              <div className="mt-2">
                                <pre className={`text-sm whitespace-pre-wrap bg-background/50 p-2 rounded border ${
                                  isExpanded ? '' : 'max-h-[80px] overflow-hidden'
                                }`}>
                                  {fieldData.value}
                                </pre>
                                {fieldData.value.length > 150 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleExpand(key)}
                                    className="mt-1 h-6 text-xs"
                                  >
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="h-3 w-3 mr-1" />
                                        Show less
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="h-3 w-3 mr-1" />
                                        Show more
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>

                              {/* Source excerpt */}
                              {fieldData.source_excerpt && (
                                <p className="text-xs text-muted-foreground mt-2 italic">
                                  Source: "{fieldData.source_excerpt}"
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Optimization Suggestions */}
                {result.optimization_suggestions && result.optimization_suggestions.length > 0 && (
                  <div className="p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-yellow-600" />
                      <span className="font-medium text-sm">Optimization Suggestions</span>
                    </div>
                    <ul className="space-y-1">
                      {result.optimization_suggestions.map((suggestion, idx) => (
                        <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-yellow-600">•</span>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedFields.size} field{selectedFields.size !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Cancel
              </Button>
              <Button 
                onClick={applySelectedFields}
                disabled={selectedFields.size === 0 || isApplying}
                className="gap-2"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Apply Selected
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
