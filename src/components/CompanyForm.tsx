import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

interface CompanyFormProps {
  companyId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const CompanyForm = ({ companyId, onSuccess, onCancel }: CompanyFormProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    business_type: "restaurant",
    voice_style: "Warm, polite Zambian receptionist.",
    hours: "Mon-Sun 10:00 – 23:00",
    menu_or_offerings: "Default menu / services list",
    branches: "Main",
    seating_areas: "poolside,outdoor,inside,VIP",
    currency_prefix: "K",
    twilio_number: "",
    credit_balance: 1000,
  });

  useEffect(() => {
    if (companyId) {
      loadCompany();
    }
  }, [companyId]);

  const loadCompany = async () => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

      if (error) throw error;
      if (data) {
        setFormData({
          name: data.name || "",
          business_type: data.business_type || "restaurant",
          voice_style: data.voice_style || "Warm, polite Zambian receptionist.",
          hours: data.hours || "Mon-Sun 10:00 – 23:00",
          menu_or_offerings: data.menu_or_offerings || "",
          branches: data.branches || "Main",
          seating_areas: data.seating_areas || "poolside,outdoor,inside,VIP",
          currency_prefix: data.currency_prefix || "K",
          twilio_number: data.twilio_number || "",
          credit_balance: data.credit_balance || 1000,
        });
      }
    } catch (error) {
      console.error('Error loading company:', error);
      toast({
        title: "Error",
        description: "Failed to load company details",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (companyId) {
        // Update existing company
        const { error } = await supabase
          .from('companies')
          .update(formData)
          .eq('id', companyId);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Company updated successfully",
        });
      } else {
        // Create new company
        const { error } = await supabase
          .from('companies')
          .insert([formData]);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Company created successfully",
        });
      }

      if (onSuccess) {
        onSuccess();
      } else {
        navigate('/admin/companies');
      }
    } catch (error) {
      console.error('Error saving company:', error);
      toast({
        title: "Error",
        description: "Failed to save company",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      navigate('/admin/companies');
    }
  };

  return (
    <Card className="card-glass">
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>{companyId ? "Edit Company" : "Create New Company"}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="business_type">Business Type</Label>
              <Input
                id="business_type"
                value={formData.business_type}
                onChange={(e) => setFormData({ ...formData, business_type: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilio_number">Twilio Number</Label>
              <Input
                id="twilio_number"
                value={formData.twilio_number}
                onChange={(e) => setFormData({ ...formData, twilio_number: e.target.value })}
                placeholder="+1234567890"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit_balance">Initial Credit Balance</Label>
              <Input
                id="credit_balance"
                type="number"
                value={formData.credit_balance}
                onChange={(e) => setFormData({ ...formData, credit_balance: parseInt(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency_prefix">Currency Prefix</Label>
              <Input
                id="currency_prefix"
                value={formData.currency_prefix}
                onChange={(e) => setFormData({ ...formData, currency_prefix: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hours">Hours of Operation</Label>
              <Input
                id="hours"
                value={formData.hours}
                onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branches">Branches (comma-separated)</Label>
              <Input
                id="branches"
                value={formData.branches}
                onChange={(e) => setFormData({ ...formData, branches: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seating_areas">Seating Areas (comma-separated)</Label>
              <Input
                id="seating_areas"
                value={formData.seating_areas}
                onChange={(e) => setFormData({ ...formData, seating_areas: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice_style">Voice Style</Label>
            <Textarea
              id="voice_style"
              value={formData.voice_style}
              onChange={(e) => setFormData({ ...formData, voice_style: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="menu_or_offerings">Menu / Services</Label>
            <Textarea
              id="menu_or_offerings"
              value={formData.menu_or_offerings}
              onChange={(e) => setFormData({ ...formData, menu_or_offerings: e.target.value })}
              rows={4}
            />
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : companyId ? "Update Company" : "Create Company"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default CompanyForm;
