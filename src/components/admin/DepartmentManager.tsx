import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Building2, Plus, Trash2, Users } from 'lucide-react';

interface DepartmentManagerProps {
  companyId: string;
}

export const DepartmentManager = ({ companyId }: DepartmentManagerProps) => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', contact_info: '', employees: '' });

  const { data: departments, isLoading } = useQuery({
    queryKey: ['company-departments', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_departments')
        .select('*')
        .eq('company_id', companyId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const employees = formData.employees
        .split(',')
        .map(e => e.trim())
        .filter(Boolean)
        .map(name => ({ name, role: 'member' }));
      
      const { error } = await supabase.from('company_departments').insert({
        company_id: companyId,
        name: formData.name,
        description: formData.description,
        contact_info: formData.contact_info || null,
        employees,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-departments'] });
      setShowForm(false);
      setFormData({ name: '', description: '', contact_info: '', employees: '' });
      toast({ title: 'Department created' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('company_departments').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company-departments'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('company_departments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-departments'] });
      toast({ title: 'Department deleted' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Departments
          </h3>
          <p className="text-sm text-muted-foreground">Configure departments for AI ticket routing</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Department
        </Button>
      </div>

      {showForm && (
        <Card className="p-4 space-y-3 border-primary/20">
          <Input
            placeholder="Department name (e.g. Billing, Technical Support)"
            value={formData.name}
            onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
          />
          <Textarea
            placeholder="Description — what this department handles"
            value={formData.description}
            onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
          />
          <Input
            placeholder="Contact info (email/phone)"
            value={formData.contact_info}
            onChange={(e) => setFormData(p => ({ ...p, contact_info: e.target.value }))}
          />
          <Input
            placeholder="Employee names (comma-separated)"
            value={formData.employees}
            onChange={(e) => setFormData(p => ({ ...p, employees: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button onClick={() => createMutation.mutate()} disabled={!formData.name} size="sm">
              Create
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)} size="sm">
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : !departments?.length ? (
        <Card className="p-8 text-center">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-muted-foreground text-sm">No departments configured</p>
          <p className="text-xs text-muted-foreground">Add departments so the AI can route tickets intelligently</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {departments.map((dept: any) => (
            <Card key={dept.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{dept.name}</span>
                    <Badge variant={dept.is_active ? 'default' : 'secondary'}>
                      {dept.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {dept.description && <p className="text-sm text-muted-foreground">{dept.description}</p>}
                  {dept.employees?.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {dept.employees.map((e: any) => e.name || e).join(', ')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={dept.is_active}
                    onCheckedChange={(val) => toggleMutation.mutate({ id: dept.id, is_active: val })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive/60 hover:text-destructive"
                    onClick={() => deleteMutation.mutate(dept.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
