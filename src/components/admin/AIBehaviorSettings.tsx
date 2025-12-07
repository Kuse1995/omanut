import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Save, RotateCcw, Plus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AIBehaviorSettingsProps {
  companyId: string;
}

export const AIBehaviorSettings = ({ companyId }: AIBehaviorSettingsProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  const [systemInstructions, setSystemInstructions] = useState("");
  const [qaStyle, setQaStyle] = useState("");
  const [bannedTopics, setBannedTopics] = useState<string[]>([]);
  const [newBannedTopic, setNewBannedTopic] = useState("");

  const [original, setOriginal] = useState({
    system_instructions: "",
    qa_style: "",
    banned_topics: "",
  });

  useEffect(() => {
    fetchSettings();
  }, [companyId]);

  useEffect(() => {
    const currentBanned = bannedTopics.join(", ");
    const changed = 
      systemInstructions !== original.system_instructions ||
      qaStyle !== original.qa_style ||
      currentBanned !== original.banned_topics;
    setHasChanges(changed);
  }, [systemInstructions, qaStyle, bannedTopics, original]);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("company_ai_overrides")
        .select("*")
        .eq("company_id", companyId)
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (data) {
        setSystemInstructions(data.system_instructions || "");
        setQaStyle(data.qa_style || "");
        setBannedTopics(data.banned_topics ? data.banned_topics.split(",").map((t: string) => t.trim()).filter(Boolean) : []);
        setOriginal({
          system_instructions: data.system_instructions || "",
          qa_style: data.qa_style || "",
          banned_topics: data.banned_topics || "",
        });
      }
    } catch (error) {
      console.error("Error fetching AI settings:", error);
      toast.error("Failed to load AI settings");
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const bannedString = bannedTopics.join(", ");
      
      const { data: existing } = await supabase
        .from("company_ai_overrides")
        .select("id")
        .eq("company_id", companyId)
        .single();

      if (existing) {
        const { error } = await supabase
          .from("company_ai_overrides")
          .update({
            system_instructions: systemInstructions,
            qa_style: qaStyle,
            banned_topics: bannedString,
          })
          .eq("company_id", companyId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("company_ai_overrides")
          .insert({
            company_id: companyId,
            system_instructions: systemInstructions,
            qa_style: qaStyle,
            banned_topics: bannedString,
          });

        if (error) throw error;
      }

      setOriginal({
        system_instructions: systemInstructions,
        qa_style: qaStyle,
        banned_topics: bannedString,
      });
      
      toast.success("AI behavior settings saved");
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const resetChanges = () => {
    setSystemInstructions(original.system_instructions);
    setQaStyle(original.qa_style);
    setBannedTopics(original.banned_topics ? original.banned_topics.split(",").map(t => t.trim()).filter(Boolean) : []);
  };

  const addBannedTopic = () => {
    if (newBannedTopic.trim() && !bannedTopics.includes(newBannedTopic.trim())) {
      setBannedTopics([...bannedTopics, newBannedTopic.trim()]);
      setNewBannedTopic("");
    }
  };

  const removeBannedTopic = (topic: string) => {
    setBannedTopics(bannedTopics.filter(t => t !== topic));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Save Bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border rounded-lg p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">You have unsaved changes</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetChanges}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button size="sm" onClick={saveSettings} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* System Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>System Instructions</CardTitle>
          <CardDescription>
            Core directives that guide the AI's behavior. Include escalation protocols, important phone numbers, and mandatory rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
            placeholder="Example: Always greet customers warmly. Never discuss competitor pricing. Escalate payment issues to the boss immediately..."
            className="min-h-[200px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-2">
            {systemInstructions.length} characters
          </p>
        </CardContent>
      </Card>

      {/* Q&A Style */}
      <Card>
        <CardHeader>
          <CardTitle>Response Style</CardTitle>
          <CardDescription>
            Define the tone, personality, and communication style for the AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={qaStyle}
            onChange={(e) => setQaStyle(e.target.value)}
            placeholder="Example: Be warm and friendly but professional. Use simple language. Keep responses brief - 1-3 sentences for simple questions. Use emoji sparingly..."
            className="min-h-[150px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-2">
            {qaStyle.length} characters
          </p>
        </CardContent>
      </Card>

      {/* Banned Topics */}
      <Card>
        <CardHeader>
          <CardTitle>Banned Topics</CardTitle>
          <CardDescription>
            Topics the AI should avoid discussing or redirect to management.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newBannedTopic}
              onChange={(e) => setNewBannedTopic(e.target.value)}
              placeholder="Add a topic to ban..."
              onKeyDown={(e) => e.key === "Enter" && addBannedTopic()}
            />
            <Button variant="outline" onClick={addBannedTopic} disabled={!newBannedTopic.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {bannedTopics.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {bannedTopics.map((topic) => (
                <Badge key={topic} variant="secondary" className="pl-3 pr-1 py-1">
                  {topic}
                  <button
                    onClick={() => removeBannedTopic(topic)}
                    className="ml-2 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No banned topics configured</p>
          )}

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Common examples: competitor pricing, legal advice, medical advice, politics, religion
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
