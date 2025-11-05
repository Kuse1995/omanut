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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CompanyFormProps {
  companyId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// Industry-specific configurations
const industryConfig = {
  restaurant: {
    voice_style: "Warm, polite receptionist. Friendly and helpful with menu recommendations.",
    hours: "Mon-Sun 10:00 – 23:00",
    menu_or_offerings: "Grilled fish, steaks, pasta, salads, desserts",
    seating_areas: "outdoor,indoor,bar,VIP",
    areas_label: "Seating Areas",
    offerings_label: "Menu",
  },
  lodge: {
    voice_style: "Warm, professional lodge receptionist. Welcoming and knowledgeable about amenities.",
    hours: "24/7 Front Desk",
    menu_or_offerings: "Accommodation, restaurant, safari tours, spa services",
    seating_areas: "poolside,garden,restaurant,lounge",
    areas_label: "Dining Areas",
    offerings_label: "Services & Amenities",
  },
  hotel: {
    voice_style: "Professional, courteous hotel receptionist. Efficient and helpful.",
    hours: "24/7 Front Desk",
    menu_or_offerings: "Room service, restaurant, conference facilities, gym, spa",
    seating_areas: "restaurant,bar,poolside,lounge",
    areas_label: "Dining Areas",
    offerings_label: "Hotel Services",
  },
  salon: {
    voice_style: "Friendly, professional salon receptionist. Knowledgeable about beauty services.",
    hours: "Mon-Sat 09:00 – 19:00",
    menu_or_offerings: "Haircuts, coloring, styling, manicures, pedicures, facials",
    seating_areas: "waiting area,VIP room",
    areas_label: "Service Areas",
    offerings_label: "Services",
  },
  spa: {
    voice_style: "Calm, soothing spa receptionist. Promotes relaxation and wellness.",
    hours: "Mon-Sun 09:00 – 21:00",
    menu_or_offerings: "Massages, facials, body treatments, aromatherapy, sauna",
    seating_areas: "relaxation lounge,VIP suite,outdoor area",
    areas_label: "Treatment Areas",
    offerings_label: "Treatments & Services",
  },
  gym: {
    voice_style: "Energetic, motivating gym receptionist. Encouraging and supportive.",
    hours: "Mon-Sun 05:00 – 22:00",
    menu_or_offerings: "Personal training, group classes, cardio equipment, weights",
    seating_areas: "main floor,studio,outdoor area",
    areas_label: "Training Areas",
    offerings_label: "Services & Facilities",
  },
  clinic: {
    voice_style: "Professional, empathetic clinic receptionist. Calm and reassuring.",
    hours: "Mon-Fri 08:00 – 17:00, Sat 09:00 – 13:00",
    menu_or_offerings: "General consultation, specialist appointments, laboratory services",
    seating_areas: "general,priority,pediatrics",
    areas_label: "Waiting Areas",
    offerings_label: "Medical Services",
  },
  school: {
    voice_style: "Friendly, organized school receptionist. Helpful with inquiries and directions.",
    hours: "Mon-Fri 07:30 – 16:00",
    menu_or_offerings: "Primary education, secondary education, extracurricular activities",
    seating_areas: "reception,visitors area",
    areas_label: "Reception Areas",
    offerings_label: "Programs & Services",
  },
  library: {
    voice_style: "Quiet, helpful library receptionist. Knowledgeable about resources.",
    hours: "Mon-Sat 08:00 – 20:00",
    menu_or_offerings: "Book lending, study rooms, computer access, research assistance",
    seating_areas: "reading room,study area,children section",
    areas_label: "Library Sections",
    offerings_label: "Services",
  },
  barbershop: {
    voice_style: "Friendly, casual barbershop receptionist. Easy-going and welcoming.",
    hours: "Mon-Sat 09:00 – 19:00",
    menu_or_offerings: "Haircuts, shaves, beard trimming, hair treatments",
    seating_areas: "waiting area,VIP chair",
    areas_label: "Service Areas",
    offerings_label: "Services",
  },
  cafe: {
    voice_style: "Warm, friendly cafe receptionist. Knowledgeable about menu items.",
    hours: "Mon-Sun 07:00 – 19:00",
    menu_or_offerings: "Coffee, tea, pastries, sandwiches, light meals",
    seating_areas: "indoor,outdoor,counter",
    areas_label: "Seating Areas",
    offerings_label: "Menu",
  },
  other: {
    voice_style: "Professional, courteous receptionist. Helpful and informative.",
    hours: "Mon-Fri 09:00 – 17:00",
    menu_or_offerings: "Services and offerings",
    seating_areas: "main area,waiting area",
    areas_label: "Areas",
    offerings_label: "Services",
  },
};

const CompanyForm = ({ companyId, onSuccess, onCancel }: CompanyFormProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    business_type: "restaurant",
    voice_style: industryConfig.restaurant.voice_style,
    hours: industryConfig.restaurant.hours,
    menu_or_offerings: industryConfig.restaurant.menu_or_offerings,
    branches: "Main",
    seating_areas: industryConfig.restaurant.seating_areas,
    currency_prefix: "K",
    twilio_number: "",
    whatsapp_number: "",
    boss_phone: "",
    whatsapp_voice_enabled: false,
    credit_balance: 1000,
    admin_email: "",
    admin_password: "",
    quick_reference_info: "",
  });

  const [aiInstructions, setAiInstructions] = useState({
    system_instructions: "",
    qa_style: "",
    banned_topics: ""
  });

  // Update form fields when business type changes
  const handleBusinessTypeChange = (value: string) => {
    const config = industryConfig[value as keyof typeof industryConfig] || industryConfig.other;
    setFormData({
      ...formData,
      business_type: value,
      voice_style: config.voice_style,
      hours: config.hours,
      menu_or_offerings: config.menu_or_offerings,
      seating_areas: config.seating_areas,
    });
  };

  const currentIndustryConfig = industryConfig[formData.business_type as keyof typeof industryConfig] || industryConfig.other;

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
          whatsapp_number: data.whatsapp_number || "",
          boss_phone: data.boss_phone || "",
          whatsapp_voice_enabled: data.whatsapp_voice_enabled || false,
          credit_balance: data.credit_balance || 1000,
          admin_email: "",
          admin_password: "",
          quick_reference_info: data.quick_reference_info || "",
        });

        // Fetch AI overrides
        const { data: aiData } = await supabase
          .from('company_ai_overrides')
          .select('*')
          .eq('company_id', data.id)
          .single();
        
        if (aiData) {
          setAiInstructions({
            system_instructions: aiData.system_instructions || "",
            qa_style: aiData.qa_style || "",
            banned_topics: aiData.banned_topics || ""
          });
        }
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
          .update({
            name: formData.name,
            business_type: formData.business_type,
            voice_style: formData.voice_style,
            hours: formData.hours,
            menu_or_offerings: formData.menu_or_offerings,
            branches: formData.branches,
            currency_prefix: formData.currency_prefix,
            seating_areas: formData.seating_areas,
            twilio_number: formData.twilio_number,
            whatsapp_number: formData.whatsapp_number,
            boss_phone: formData.boss_phone,
            whatsapp_voice_enabled: formData.whatsapp_voice_enabled,
            quick_reference_info: formData.quick_reference_info,
          })
          .eq('id', companyId);

        if (error) throw error;

        // Upsert AI instructions
        const { error: aiError } = await supabase
          .from('company_ai_overrides')
          .upsert({
            company_id: companyId,
            system_instructions: aiInstructions.system_instructions,
            qa_style: aiInstructions.qa_style,
            banned_topics: aiInstructions.banned_topics
          });

        if (aiError) throw aiError;

        toast({
          title: "Success",
          description: "Company updated successfully",
        });
        
        if (onSuccess) onSuccess();
      } else {
        // Create new company with admin user via edge function
        if (!formData.admin_email || !formData.admin_password) {
          throw new Error('Admin email and password are required for new companies');
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-company`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: formData.name,
              business_type: formData.business_type,
              voice_style: formData.voice_style,
              hours: formData.hours,
              menu_or_offerings: formData.menu_or_offerings,
              branches: formData.branches,
              currency_prefix: formData.currency_prefix,
              seating_areas: formData.seating_areas,
              twilio_number: formData.twilio_number,
              whatsapp_number: formData.whatsapp_number,
              boss_phone: formData.boss_phone,
              whatsapp_voice_enabled: formData.whatsapp_voice_enabled,
              credit_balance: formData.credit_balance,
              quick_reference_info: formData.quick_reference_info,
              admin_email: formData.admin_email,
              admin_password: formData.admin_password,
              system_instructions: aiInstructions.system_instructions,
              qa_style: aiInstructions.qa_style,
              banned_topics: aiInstructions.banned_topics,
            }),
          }
        );

        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Failed to create company');
        }

        toast({
          title: "Success",
          description: `Company created successfully. Admin login: ${formData.admin_email}`,
        });
        
        if (onSuccess) onSuccess();
        else navigate('/admin/companies');
      }
    } catch (error: any) {
      console.error('Error saving company:', error);
      toast({
        title: "Error",
        description: error.message,
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <Select
                value={formData.business_type}
                onValueChange={handleBusinessTypeChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="restaurant">Restaurant</SelectItem>
                  <SelectItem value="cafe">Cafe</SelectItem>
                  <SelectItem value="lodge">Lodge</SelectItem>
                  <SelectItem value="hotel">Hotel</SelectItem>
                  <SelectItem value="salon">Salon</SelectItem>
                  <SelectItem value="spa">Spa</SelectItem>
                  <SelectItem value="barbershop">Barbershop</SelectItem>
                  <SelectItem value="gym">Gym/Fitness Center</SelectItem>
                  <SelectItem value="clinic">Clinic/Medical Center</SelectItem>
                  <SelectItem value="school">School</SelectItem>
                  <SelectItem value="library">Library</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilio_number">Phone Number (PSTN)</Label>
              <Input
                id="twilio_number"
                value={formData.twilio_number}
                onChange={(e) => setFormData({ ...formData, twilio_number: e.target.value })}
                placeholder="+1234567890"
              />
              <p className="text-xs text-muted-foreground">For regular phone calls</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp_number">WhatsApp Number</Label>
              <Input
                id="whatsapp_number"
                value={formData.whatsapp_number}
                onChange={(e) => setFormData({ ...formData, whatsapp_number: e.target.value })}
                placeholder="whatsapp:+1234567890"
              />
              <p className="text-xs text-muted-foreground">For WhatsApp messages and calls</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="boss_phone">Boss WhatsApp Number</Label>
              <Input
                id="boss_phone"
                value={formData.boss_phone}
                onChange={(e) => setFormData({ ...formData, boss_phone: e.target.value })}
                placeholder="whatsapp:+1234567890"
              />
              <p className="text-xs text-muted-foreground">AI will send reports & respond to queries from this number</p>
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
              <Label htmlFor="seating_areas">{currentIndustryConfig.areas_label} (comma-separated)</Label>
              <Input
                id="seating_areas"
                value={formData.seating_areas}
                onChange={(e) => setFormData({ ...formData, seating_areas: e.target.value })}
                placeholder={currentIndustryConfig.seating_areas}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp_voice_enabled">WhatsApp Voice Calls</Label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="whatsapp_voice_enabled"
                  checked={formData.whatsapp_voice_enabled}
                  onChange={(e) => setFormData({ ...formData, whatsapp_voice_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="whatsapp_voice_enabled" className="font-normal">
                  Enable voice calls via WhatsApp
                </Label>
              </div>
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
            <Label htmlFor="menu_or_offerings">{currentIndustryConfig.offerings_label}</Label>
            <Textarea
              id="menu_or_offerings"
              value={formData.menu_or_offerings}
              onChange={(e) => setFormData({ ...formData, menu_or_offerings: e.target.value })}
              rows={4}
              placeholder={currentIndustryConfig.menu_or_offerings}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quick_reference_info">Quick Reference Information</Label>
            <Textarea
              id="quick_reference_info"
              value={formData.quick_reference_info}
              onChange={(e) => setFormData({ ...formData, quick_reference_info: e.target.value })}
              rows={6}
              placeholder="Paste any information the AI should know about your business - pricing, policies, FAQs, special offers, etc. This will be used by the AI to answer client questions."
            />
            <p className="text-xs text-muted-foreground">
              Add frequently requested information here for quick AI access. Use document uploads for large complex files.
            </p>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4 text-foreground">AI Instructions & Behavior</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Customize how the AI assistant responds and behaves for this company
            </p>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="system_instructions">Custom System Instructions</Label>
                <Textarea
                  id="system_instructions"
                  value={aiInstructions.system_instructions}
                  onChange={(e) => setAiInstructions({ ...aiInstructions, system_instructions: e.target.value })}
                  placeholder="Add specific instructions for the AI (e.g., 'Always mention our special promotions', 'Use friendly, casual language', etc.)"
                  className="min-h-[120px]"
                />
                <p className="text-xs text-muted-foreground">
                  These instructions will guide how the AI responds. Be specific about tone, topics to emphasize, and how to handle common questions.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qa_style">Question & Answer Style</Label>
                <Textarea
                  id="qa_style"
                  value={aiInstructions.qa_style}
                  onChange={(e) => setAiInstructions({ ...aiInstructions, qa_style: e.target.value })}
                  placeholder="Define how the AI should answer questions (e.g., 'Keep answers under 2 sentences', 'Always ask clarifying questions', 'Provide detailed explanations')"
                  className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground">
                  This helps the AI understand synonyms and variations. Example: "Tuition, fees, cost, price all mean the same thing - answer with our pricing information"
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="banned_topics">Topics to Avoid</Label>
                <Textarea
                  id="banned_topics"
                  value={aiInstructions.banned_topics}
                  onChange={(e) => setAiInstructions({ ...aiInstructions, banned_topics: e.target.value })}
                  placeholder="List topics the AI should not discuss (e.g., 'Do not discuss competitor pricing', 'Avoid political topics', etc.)"
                  className="min-h-[80px]"
                />
                <p className="text-xs text-muted-foreground">
                  Specify what topics the AI should politely decline to answer or redirect.
                </p>
              </div>
            </div>
          </div>

          {!companyId && (
            <>
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">Admin Account</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin_email">Admin Email *</Label>
                    <Input
                      id="admin_email"
                      type="email"
                      value={formData.admin_email}
                      onChange={(e) => setFormData({ ...formData, admin_email: e.target.value })}
                      required={!companyId}
                      placeholder="admin@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin_password">Admin Password *</Label>
                    <Input
                      id="admin_password"
                      type="password"
                      value={formData.admin_password}
                      onChange={(e) => setFormData({ ...formData, admin_password: e.target.value })}
                      required={!companyId}
                      placeholder="Secure password"
                      minLength={6}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="credit_balance">Initial Credit Balance</Label>
                <Input
                  id="credit_balance"
                  type="number"
                  value={formData.credit_balance}
                  onChange={(e) => setFormData({ ...formData, credit_balance: parseInt(e.target.value) || 1000 })}
                />
              </div>
            </>
          )}

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