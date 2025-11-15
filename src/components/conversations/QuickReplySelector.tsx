import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface QuickReplyTemplate {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  category: string;
}

interface QuickReplySelectorProps {
  onSelect: (template: QuickReplyTemplate) => void;
}

export const QuickReplySelector = ({ onSelect }: QuickReplySelectorProps) => {
  const [templates, setTemplates] = useState<QuickReplyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', session.user.id)
        .single();

      if (!userData?.company_id) return;

      const { data, error } = await supabase
        .from('quick_reply_templates')
        .select('*')
        .eq('company_id', userData.company_id)
        .order('category', { ascending: true });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast({
        title: "Error",
        description: "Failed to load quick replies",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const categorizedTemplates = templates.reduce((acc, template) => {
    const category = template.category || 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {} as Record<string, QuickReplyTemplate[]>);

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Loading templates...
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No quick reply templates yet. Add some in Settings.
      </div>
    );
  }

  return (
    <ScrollArea className="h-48 p-2">
      <div className="space-y-3">
        {Object.entries(categorizedTemplates).map(([category, temps]) => (
          <div key={category}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 px-2">
              {category}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {temps.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  className="justify-start h-auto py-2 px-3"
                  onClick={() => onSelect(template)}
                >
                  <div className="text-left w-full">
                    <div className="font-medium text-sm">{template.title}</div>
                    {template.shortcut && (
                      <div className="text-xs text-muted-foreground">/{template.shortcut}</div>
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};
