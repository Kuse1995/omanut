import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AIConfig } from "../AIDeepSettings";
import { Wrench, Plus, X, AlertCircle } from "lucide-react";

interface ToolControlPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

const AVAILABLE_TOOLS = [
  { id: 'create_reservation', name: 'Create Reservation', description: 'Creates reservations in the database', category: 'Booking' },
  { id: 'get_date_info', name: 'Get Date Info', description: 'Validates and parses dates', category: 'Utility' },
  { id: 'check_availability', name: 'Check Availability', description: 'Checks booking availability', category: 'Booking' },
  { id: 'send_media', name: 'Send Media', description: 'Sends images/videos to customers', category: 'Communication' },
  { id: 'lookup_product', name: 'Lookup Product', description: 'Searches product catalog', category: 'Sales' },
  { id: 'request_payment', name: 'Request Payment', description: 'Initiates payment flow', category: 'Payment' },
  { id: 'notify_boss', name: 'Notify Boss', description: 'Sends notification to management', category: 'Communication' },
  { id: 'update_customer', name: 'Update Customer', description: 'Updates customer information', category: 'CRM' },
];

export const ToolControlPanel = ({ config, updateConfig }: ToolControlPanelProps) => {
  const [newConfirmTool, setNewConfirmTool] = useState('');

  const toggleTool = (toolId: string) => {
    const enabled = config.enabled_tools.includes(toolId);
    if (enabled) {
      updateConfig({ enabled_tools: config.enabled_tools.filter(t => t !== toolId) });
    } else {
      updateConfig({ enabled_tools: [...config.enabled_tools, toolId] });
    }
  };

  const addConfirmationTool = () => {
    if (newConfirmTool.trim() && !config.require_confirmation_for.includes(newConfirmTool.trim())) {
      updateConfig({ require_confirmation_for: [...config.require_confirmation_for, newConfirmTool.trim()] });
      setNewConfirmTool('');
    }
  };

  const removeConfirmationTool = (tool: string) => {
    updateConfig({ require_confirmation_for: config.require_confirmation_for.filter(t => t !== tool) });
  };

  const groupedTools = AVAILABLE_TOOLS.reduce((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, typeof AVAILABLE_TOOLS>);

  return (
    <div className="space-y-6">
      {/* Enabled Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Enabled Tools
          </CardTitle>
          <CardDescription>Control which tools the AI can use</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(groupedTools).map(([category, tools]) => (
            <div key={category} className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">{category}</h4>
              <div className="space-y-2">
                {tools.map(tool => (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/30 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{tool.name}</span>
                        {config.require_confirmation_for.includes(tool.id) && (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Needs Confirm
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                    <Switch
                      checked={config.enabled_tools.includes(tool.id)}
                      onCheckedChange={() => toggleTool(tool.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Confirmation Required */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Require Confirmation
          </CardTitle>
          <CardDescription>Tools that require explicit user confirmation before execution</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {config.require_confirmation_for.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tools require confirmation</p>
            ) : (
              config.require_confirmation_for.map(tool => (
                <Badge key={tool} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                  {tool}
                  <button
                    onClick={() => removeConfirmationTool(tool)}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newConfirmTool}
              onChange={(e) => setNewConfirmTool(e.target.value)}
              placeholder="Add tool name..."
              onKeyDown={(e) => e.key === 'Enter' && addConfirmationTool()}
            />
            <Button variant="outline" size="icon" onClick={addConfirmationTool}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            AI will ask "Should I proceed with X?" before executing these tools
          </p>
        </CardContent>
      </Card>

      {/* Tool Limits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tool Execution Limits</CardTitle>
          <CardDescription>Prevent runaway tool executions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="space-y-0.5">
              <Label>Max Tool Rounds</Label>
              <p className="text-xs text-muted-foreground">
                Current: {config.max_tool_rounds} rounds per message
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateConfig({ max_tool_rounds: Math.max(1, config.max_tool_rounds - 1) })}
              >
                -
              </Button>
              <span className="w-8 text-center font-mono">{config.max_tool_rounds}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateConfig({ max_tool_rounds: Math.min(5, config.max_tool_rounds + 1) })}
              >
                +
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
