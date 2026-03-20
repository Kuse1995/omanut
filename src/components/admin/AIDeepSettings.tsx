import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw, Cpu, Settings2, Users, Wrench, FlaskConical, Shield } from "lucide-react";
import { ModelConfigPanel } from "./deep-settings/ModelConfigPanel";
import { GenerationParamsPanel } from "./deep-settings/GenerationParamsPanel";
import { AgentConfigPanel } from "./deep-settings/AgentConfigPanel";
import { ToolControlPanel } from "./deep-settings/ToolControlPanel";
import { ABTestPanel } from "./deep-settings/ABTestPanel";
import { QualitySafetyPanel } from "./deep-settings/QualitySafetyPanel";

interface AIDeepSettingsProps {
  companyId: string;
}

export interface AIConfig {
  // Model Configuration
  primary_model: string;
  routing_model: string;
  analysis_model: string;
  voice_model: string;
  voice_style: string;
  
  // Generation Parameters
  primary_temperature: number;
  routing_temperature: number;
  max_tokens: number;
  max_tool_rounds: number;
  response_length: string;
  response_timeout_seconds: number;
  fallback_message: string;
  
  // Agent Prompts
  support_agent_prompt: string;
  sales_agent_prompt: string;
  boss_agent_prompt: string;
  system_instructions: string;
  qa_style: string;
  banned_topics: string;
  
  // Routing Configuration
  routing_enabled: boolean;
  routing_confidence_threshold: number;
  auto_handoff_triggers: string[];
  supervisor_enabled: boolean;
  complexity_threshold: number;
  
  // Tool Controls
  enabled_tools: string[];
  require_confirmation_for: string[];
  
  // Quality & Safety
  quality_scoring_enabled: boolean;
  auto_flag_threshold: number;
  content_filtering_level: string;
  
  // Video Provider
  video_provider: string;

  // A/B Testing
  ab_test_enabled: boolean;
  ab_test_variant: string;
  ab_test_model: string;

  // Boss Reporting Configuration
  boss_reporting_style: string;
  boss_data_focus: string[];
  boss_alert_triggers: {
    low_engagement: boolean;
    missed_opportunities: boolean;
    negative_feedback: boolean;
    high_value_customers: boolean;
    unusual_patterns: boolean;
  };
  boss_daily_briefing_template: string;
  boss_metric_goals: {
    daily_revenue: number;
    weekly_conversations: number;
    conversion_rate: number;
  };
  boss_preferred_language: string;
  boss_report_frequency: string;
  boss_comparison_period: string;

  // Supervisor Agent Configuration
  supervisor_analysis_depth: string;
  supervisor_focus_areas: string[];
  supervisor_recommendation_style: string;
  supervisor_context_window: number;
  supervisor_research_enabled: boolean;
  supervisor_live_analysis_enabled: boolean;
  supervisor_pattern_detection: string[];
  supervisor_urgency_triggers: {
    high_value_customer: boolean;
    complaint: boolean;
    churn_risk: boolean;
    escalation_needed: boolean;
    competitor_mention: boolean;
  };
  supervisor_output_format: string;
}

const defaultConfig: AIConfig = {
  primary_model: 'google/gemini-3-pro-preview',
  routing_model: 'deepseek-chat',
  analysis_model: 'google/gemini-2.5-flash',
  voice_model: 'gpt-4o-realtime-preview-2024-12-17',
  voice_style: 'alloy',
  primary_temperature: 1.0,
  routing_temperature: 0.3,
  max_tokens: 2048,
  max_tool_rounds: 2,
  response_length: 'balanced',
  response_timeout_seconds: 30,
  fallback_message: 'Thank you for your patience. Someone will respond shortly.',
  support_agent_prompt: '',
  sales_agent_prompt: '',
  boss_agent_prompt: '',
  system_instructions: '',
  qa_style: '',
  banned_topics: '',
  routing_enabled: true,
  routing_confidence_threshold: 0.6,
  auto_handoff_triggers: ['payment', 'refund', 'lawsuit', 'urgent', 'manager'],
  supervisor_enabled: true,
  complexity_threshold: 50,
  enabled_tools: ['create_reservation', 'get_date_info', 'check_availability', 'send_media', 'lookup_product'],
  require_confirmation_for: [],
  quality_scoring_enabled: true,
  auto_flag_threshold: 70,
  content_filtering_level: 'standard',
  ab_test_enabled: false,
  ab_test_variant: '',
  ab_test_model: '',
  // Boss Reporting defaults
  boss_reporting_style: 'concise',
  boss_data_focus: ['revenue', 'conversations', 'reservations'],
  boss_alert_triggers: {
    low_engagement: true,
    missed_opportunities: true,
    negative_feedback: true,
    high_value_customers: false,
    unusual_patterns: false,
  },
  boss_daily_briefing_template: '',
  boss_metric_goals: {
    daily_revenue: 0,
    weekly_conversations: 0,
    conversion_rate: 0,
  },
  boss_preferred_language: 'en',
  boss_report_frequency: 'on_request',
  boss_comparison_period: 'last_week',
  // Supervisor Agent defaults
  supervisor_analysis_depth: 'balanced',
  supervisor_focus_areas: ['conversion_optimization', 'customer_satisfaction'],
  supervisor_recommendation_style: 'actionable',
  supervisor_context_window: 10,
  supervisor_research_enabled: true,
  supervisor_live_analysis_enabled: true,
  supervisor_pattern_detection: ['buying_signals', 'objections', 'sentiment_shifts'],
  supervisor_urgency_triggers: {
    high_value_customer: true,
    complaint: true,
    churn_risk: true,
    escalation_needed: false,
    competitor_mention: false,
  },
  supervisor_output_format: 'structured_json',
};

export const AIDeepSettings = ({ companyId }: AIDeepSettingsProps) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AIConfig>(defaultConfig);
  const [originalConfig, setOriginalConfig] = useState<AIConfig>(defaultConfig);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("models");

  useEffect(() => {
    fetchConfig();
  }, [companyId]);

  useEffect(() => {
    const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
    setHasChanges(changed);
  }, [config, originalConfig]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('company_ai_overrides')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        const loadedConfig: AIConfig = {
          primary_model: data.primary_model || defaultConfig.primary_model,
          routing_model: data.routing_model || defaultConfig.routing_model,
          analysis_model: data.analysis_model || defaultConfig.analysis_model,
          voice_model: data.voice_model || defaultConfig.voice_model,
          voice_style: data.voice_style || defaultConfig.voice_style,
          primary_temperature: data.primary_temperature ?? defaultConfig.primary_temperature,
          routing_temperature: data.routing_temperature ?? defaultConfig.routing_temperature,
          max_tokens: data.max_tokens ?? defaultConfig.max_tokens,
          max_tool_rounds: data.max_tool_rounds ?? defaultConfig.max_tool_rounds,
          response_length: data.response_length || defaultConfig.response_length,
          response_timeout_seconds: data.response_timeout_seconds ?? defaultConfig.response_timeout_seconds,
          fallback_message: data.fallback_message || defaultConfig.fallback_message,
          support_agent_prompt: data.support_agent_prompt || '',
          sales_agent_prompt: data.sales_agent_prompt || '',
          boss_agent_prompt: data.boss_agent_prompt || '',
          system_instructions: data.system_instructions || '',
          qa_style: data.qa_style || '',
          banned_topics: data.banned_topics || '',
          routing_enabled: data.routing_enabled ?? defaultConfig.routing_enabled,
          routing_confidence_threshold: data.routing_confidence_threshold ?? defaultConfig.routing_confidence_threshold,
          auto_handoff_triggers: data.auto_handoff_triggers || defaultConfig.auto_handoff_triggers,
          supervisor_enabled: data.supervisor_enabled ?? defaultConfig.supervisor_enabled,
          complexity_threshold: data.complexity_threshold ?? defaultConfig.complexity_threshold,
          enabled_tools: data.enabled_tools || defaultConfig.enabled_tools,
          require_confirmation_for: data.require_confirmation_for || defaultConfig.require_confirmation_for,
          quality_scoring_enabled: data.quality_scoring_enabled ?? defaultConfig.quality_scoring_enabled,
          auto_flag_threshold: data.auto_flag_threshold ?? defaultConfig.auto_flag_threshold,
          content_filtering_level: data.content_filtering_level || defaultConfig.content_filtering_level,
          ab_test_enabled: data.ab_test_enabled ?? defaultConfig.ab_test_enabled,
          ab_test_variant: data.ab_test_variant || '',
          ab_test_model: data.ab_test_model || '',
          // Boss Reporting config
          boss_reporting_style: data.boss_reporting_style || defaultConfig.boss_reporting_style,
          boss_data_focus: data.boss_data_focus || defaultConfig.boss_data_focus,
          boss_alert_triggers: (data.boss_alert_triggers as AIConfig['boss_alert_triggers']) || defaultConfig.boss_alert_triggers,
          boss_daily_briefing_template: data.boss_daily_briefing_template || '',
          boss_metric_goals: (data.boss_metric_goals as AIConfig['boss_metric_goals']) || defaultConfig.boss_metric_goals,
          boss_preferred_language: data.boss_preferred_language || defaultConfig.boss_preferred_language,
          boss_report_frequency: data.boss_report_frequency || defaultConfig.boss_report_frequency,
          boss_comparison_period: data.boss_comparison_period || defaultConfig.boss_comparison_period,
          // Supervisor Agent config
          supervisor_analysis_depth: data.supervisor_analysis_depth || defaultConfig.supervisor_analysis_depth,
          supervisor_focus_areas: data.supervisor_focus_areas || defaultConfig.supervisor_focus_areas,
          supervisor_recommendation_style: data.supervisor_recommendation_style || defaultConfig.supervisor_recommendation_style,
          supervisor_context_window: data.supervisor_context_window ?? defaultConfig.supervisor_context_window,
          supervisor_research_enabled: data.supervisor_research_enabled ?? defaultConfig.supervisor_research_enabled,
          supervisor_live_analysis_enabled: data.supervisor_live_analysis_enabled ?? defaultConfig.supervisor_live_analysis_enabled,
          supervisor_pattern_detection: data.supervisor_pattern_detection || defaultConfig.supervisor_pattern_detection,
          supervisor_urgency_triggers: (data.supervisor_urgency_triggers as AIConfig['supervisor_urgency_triggers']) || defaultConfig.supervisor_urgency_triggers,
          supervisor_output_format: data.supervisor_output_format || defaultConfig.supervisor_output_format,
        };
        setConfig(loadedConfig);
        setOriginalConfig(loadedConfig);
      }
    } catch (error) {
      console.error('Error loading AI config:', error);
      toast.error('Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_ai_overrides')
        .upsert({
          company_id: companyId,
          ...config,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' });

      if (error) throw error;

      setOriginalConfig(config);
      toast.success('AI configuration saved');
    } catch (error) {
      console.error('Error saving AI config:', error);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const resetConfig = () => {
    setConfig(originalConfig);
    toast.info('Changes discarded');
  };

  const updateConfig = (updates: Partial<AIConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Save Bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm font-medium text-foreground">You have unsaved changes</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={resetConfig} disabled={saving}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Discard
            </Button>
            <Button size="sm" onClick={saveConfig} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Deep AI Configuration
          </CardTitle>
          <CardDescription>
            Advanced controls for AI models, generation parameters, agent behavior, and more.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="models" className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                <span className="hidden lg:inline">Models</span>
              </TabsTrigger>
              <TabsTrigger value="generation" className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                <span className="hidden lg:inline">Generation</span>
              </TabsTrigger>
              <TabsTrigger value="agents" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden lg:inline">Agents</span>
              </TabsTrigger>
              <TabsTrigger value="tools" className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                <span className="hidden lg:inline">Tools</span>
              </TabsTrigger>
              <TabsTrigger value="quality" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span className="hidden lg:inline">Quality</span>
              </TabsTrigger>
              <TabsTrigger value="testing" className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                <span className="hidden lg:inline">A/B Test</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <TabsContent value="models">
                <ModelConfigPanel config={config} updateConfig={updateConfig} />
              </TabsContent>

              <TabsContent value="generation">
                <GenerationParamsPanel config={config} updateConfig={updateConfig} />
              </TabsContent>

              <TabsContent value="agents">
                <AgentConfigPanel config={config} updateConfig={updateConfig} />
              </TabsContent>

              <TabsContent value="tools">
                <ToolControlPanel config={config} updateConfig={updateConfig} />
              </TabsContent>

              <TabsContent value="quality">
                <QualitySafetyPanel config={config} updateConfig={updateConfig} />
              </TabsContent>

              <TabsContent value="testing">
                <ABTestPanel config={config} updateConfig={updateConfig} />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
