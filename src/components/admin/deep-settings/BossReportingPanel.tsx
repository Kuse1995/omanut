import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Crown, BarChart3, Bell, FileText, Target, Calendar, Globe } from "lucide-react";

export interface BossReportingConfig {
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
}

interface BossReportingPanelProps {
  config: BossReportingConfig;
  updateConfig: (updates: Partial<BossReportingConfig>) => void;
}

const dataFocusOptions = [
  { id: 'revenue', label: 'Revenue & Payments', description: 'Sales figures, pending payments, revenue trends' },
  { id: 'conversations', label: 'Conversation Analytics', description: 'Message volume, response times, engagement' },
  { id: 'reservations', label: 'Reservations', description: 'Booking stats, cancellations, capacity' },
  { id: 'customer_insights', label: 'Customer Insights', description: 'Preferences, feedback, noted information' },
  { id: 'action_items', label: 'Action Items', description: 'Pending tasks, follow-ups, escalations' },
  { id: 'competitor_mentions', label: 'Competitor Mentions', description: 'When customers mention competitors' },
  { id: 'sentiment', label: 'Customer Sentiment', description: 'Overall mood and satisfaction indicators' },
];

export const BossReportingPanel = ({ config, updateConfig }: BossReportingPanelProps) => {
  const toggleDataFocus = (id: string) => {
    const current = config.boss_data_focus || [];
    const updated = current.includes(id)
      ? current.filter(f => f !== id)
      : [...current, id];
    updateConfig({ boss_data_focus: updated });
  };

  const updateAlertTrigger = (key: keyof BossReportingConfig['boss_alert_triggers'], value: boolean) => {
    updateConfig({
      boss_alert_triggers: {
        ...config.boss_alert_triggers,
        [key]: value
      }
    });
  };

  const updateMetricGoal = (key: keyof BossReportingConfig['boss_metric_goals'], value: number) => {
    updateConfig({
      boss_metric_goals: {
        ...config.boss_metric_goals,
        [key]: value
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Reporting Style Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            Reporting Style
          </CardTitle>
          <CardDescription>Configure how the AI communicates with management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Report Format</Label>
              <Select
                value={config.boss_reporting_style || 'concise'}
                onValueChange={(v) => updateConfig({ boss_reporting_style: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">Concise Bullet Points</SelectItem>
                  <SelectItem value="detailed">Detailed Narrative</SelectItem>
                  <SelectItem value="data_heavy">Data-Heavy with Metrics</SelectItem>
                  <SelectItem value="executive">Executive Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Preferred Language</Label>
              <Select
                value={config.boss_preferred_language || 'en'}
                onValueChange={(v) => updateConfig({ boss_preferred_language: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="pt">Portuguese</SelectItem>
                  <SelectItem value="sw">Swahili</SelectItem>
                  <SelectItem value="zu">Zulu</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Report Frequency</Label>
              <Select
                value={config.boss_report_frequency || 'on_request'}
                onValueChange={(v) => updateConfig({ boss_report_frequency: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_request">On Request Only</SelectItem>
                  <SelectItem value="daily">Daily Briefing</SelectItem>
                  <SelectItem value="weekly">Weekly Summary</SelectItem>
                  <SelectItem value="real_time">Real-time Alerts</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Comparison Period</Label>
              <Select
                value={config.boss_comparison_period || 'last_week'}
                onValueChange={(v) => updateConfig({ boss_comparison_period: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="last_week">Last Week</SelectItem>
                  <SelectItem value="last_month">Last Month</SelectItem>
                  <SelectItem value="same_day_last_week">Same Day Last Week</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Focus Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Data Focus
          </CardTitle>
          <CardDescription>Select what data to include in management reports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dataFocusOptions.map(option => (
              <div
                key={option.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  (config.boss_data_focus || []).includes(option.id)
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-muted/30 border-border hover:bg-muted/50'
                }`}
                onClick={() => toggleDataFocus(option.id)}
              >
                <Checkbox
                  checked={(config.boss_data_focus || []).includes(option.id)}
                  onCheckedChange={() => toggleDataFocus(option.id)}
                />
                <div className="space-y-0.5">
                  <Label className="cursor-pointer font-medium">{option.label}</Label>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Alert & Escalation Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-red-500" />
            Alert Triggers
          </CardTitle>
          <CardDescription>Configure when to proactively alert management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Low Engagement Periods</Label>
                <p className="text-xs text-muted-foreground">Alert when customer engagement drops significantly</p>
              </div>
              <Switch
                checked={config.boss_alert_triggers?.low_engagement ?? true}
                onCheckedChange={(v) => updateAlertTrigger('low_engagement', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Missed Opportunities</Label>
                <p className="text-xs text-muted-foreground">Alert when potential sales are lost</p>
              </div>
              <Switch
                checked={config.boss_alert_triggers?.missed_opportunities ?? true}
                onCheckedChange={(v) => updateAlertTrigger('missed_opportunities', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Negative Feedback</Label>
                <p className="text-xs text-muted-foreground">Alert when customers express dissatisfaction</p>
              </div>
              <Switch
                checked={config.boss_alert_triggers?.negative_feedback ?? true}
                onCheckedChange={(v) => updateAlertTrigger('negative_feedback', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>High-Value Customer Interactions</Label>
                <p className="text-xs text-muted-foreground">Alert when VIP or high-spending customers message</p>
              </div>
              <Switch
                checked={config.boss_alert_triggers?.high_value_customers ?? false}
                onCheckedChange={(v) => updateAlertTrigger('high_value_customers', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Unusual Patterns</Label>
                <p className="text-xs text-muted-foreground">Alert when unusual activity is detected</p>
              </div>
              <Switch
                checked={config.boss_alert_triggers?.unusual_patterns ?? false}
                onCheckedChange={(v) => updateAlertTrigger('unusual_patterns', v)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Templates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-500" />
            Report Templates
          </CardTitle>
          <CardDescription>Custom templates for different report types</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Daily Briefing Template</Label>
            <Textarea
              value={config.boss_daily_briefing_template || ''}
              onChange={(e) => updateConfig({ boss_daily_briefing_template: e.target.value })}
              placeholder="Example: Start with today's key metrics, then highlight any issues, followed by opportunities..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Guide how the AI structures daily updates
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Goal Tracking */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-green-500" />
            Goal Tracking
          </CardTitle>
          <CardDescription>Set targets for the AI to compare against in reports</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Daily Revenue Target</Label>
              <Input
                type="number"
                value={config.boss_metric_goals?.daily_revenue || 0}
                onChange={(e) => updateMetricGoal('daily_revenue', parseFloat(e.target.value) || 0)}
                placeholder="e.g., 5000"
              />
            </div>

            <div className="space-y-2">
              <Label>Weekly Conversations Target</Label>
              <Input
                type="number"
                value={config.boss_metric_goals?.weekly_conversations || 0}
                onChange={(e) => updateMetricGoal('weekly_conversations', parseInt(e.target.value) || 0)}
                placeholder="e.g., 100"
              />
            </div>

            <div className="space-y-2">
              <Label>Conversion Rate Target (%)</Label>
              <Input
                type="number"
                value={config.boss_metric_goals?.conversion_rate || 0}
                onChange={(e) => updateMetricGoal('conversion_rate', parseFloat(e.target.value) || 0)}
                placeholder="e.g., 15"
                min={0}
                max={100}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The AI will compare actual performance against these goals when providing updates
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
