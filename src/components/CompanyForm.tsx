import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Search, Loader2, Sparkles, Check, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface CompanyFormProps {
  companyId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// Industry-specific configurations
const industryConfig: Record<string, {
  voice_style: string;
  hours: string;
  services: string;
  branches: string;
  service_locations: string;
  currency_prefix: string;
  locations_label: string;
  services_label: string;
  locations_prompt: string;
  confirmation_template: string;
}> = {
  restaurant: {
    voice_style: "Warm, polite receptionist. Friendly and helpful with recommendations.",
    hours: "Mon-Sun 10:00 – 23:00",
    services: "Grilled fish, steaks, pasta, salads, desserts",
    branches: "Main",
    service_locations: "outdoor,indoor,bar,VIP",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area would you prefer?",
    confirmation_template: "booking for {guests} on {date} at {time} in the {location} area"
  },
  clinic: {
    voice_style: "Professional, empathetic receptionist. Calm and reassuring.",
    hours: "Mon-Fri 08:00 – 17:00, Sat 09:00 – 13:00",
    services: "General consultation, specialist appointments, laboratory services, X-rays",
    branches: "Main",
    service_locations: "general,priority,pediatrics,specialist wing",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area do you need?",
    confirmation_template: "appointment on {date} at {time} in the {location} area"
  },
  gym: {
    voice_style: "Energetic, motivating receptionist. Encouraging and supportive.",
    hours: "Mon-Sun 05:00 – 22:00",
    services: "Personal training, group classes, cardio equipment, weights, yoga",
    branches: "Main",
    service_locations: "main floor,studio,outdoor area,spin room",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area would you like to use?",
    confirmation_template: "session on {date} at {time} in the {location} area"
  },
  salon: {
    voice_style: "Friendly, professional receptionist. Knowledgeable and helpful.",
    hours: "Mon-Sat 09:00 – 19:00",
    services: "Haircuts, coloring, styling, manicures, pedicures, facials",
    branches: "Main",
    service_locations: "main salon,VIP room,spa area",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area would you prefer?",
    confirmation_template: "appointment on {date} at {time} in the {location} area"
  },
  hotel: {
    voice_style: "Warm, professional receptionist. Helpful and accommodating.",
    hours: "24/7",
    services: "Room booking, restaurant, spa, pool, gym, conference rooms",
    branches: "Main",
    service_locations: "poolside,restaurant,spa,conference,rooms",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area would you like to book?",
    confirmation_template: "reservation on {date} at {time} at our {location} area"
  },
  spa: {
    voice_style: "Calm, soothing receptionist. Creates relaxing atmosphere.",
    hours: "Mon-Sun 09:00 – 20:00",
    services: "Massages, facials, body treatments, manicures, pedicures",
    branches: "Main",
    service_locations: "treatment rooms,relaxation lounge,sauna,VIP suite",
    currency_prefix: "K",
    locations_label: "Service Areas",
    services_label: "Services & Offerings",
    locations_prompt: "Which area would you prefer?",
    confirmation_template: "appointment on {date} at {time} in the {location} area"
  },
  other: {
    voice_style: "Professional, courteous receptionist. Helpful and informative.",
    hours: "Mon-Fri 09:00 – 17:00",
    services: "Various services available",
    branches: "Main",
    service_locations: "main area,consultation room,meeting room",
    currency_prefix: "K",
    locations_label: "Service Locations",
    services_label: "Services",
    locations_prompt: "Which location would you prefer?",
    confirmation_template: "appointment on {date} at {time}"
  }
};

const CompanyForm = ({ companyId, onSuccess, onCancel }: CompanyFormProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    industry: "",
    custom_industry: "",
    business_type: "",
    voice_style: "",
    hours: "",
    services: "",
    branches: "",
    service_locations: "",
    currency_prefix: "K",
    twilio_number: "",
    whatsapp_number: "",
    boss_phone: "",
    meta_phone_number_id: "",
    meta_business_account_id: "",
    whatsapp_voice_enabled: false,
    test_mode: true,
    credit_balance: 1000,
    admin_email: "",
    admin_password: "",
    quick_reference_info: "",
    google_calendar_id: "",
    calendar_sync_enabled: false,
    booking_buffer_minutes: 15
  });

  const [showCustomIndustry, setShowCustomIndustry] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchResults, setResearchResults] = useState<any>(null);
  const [showResearchPreview, setShowResearchPreview] = useState(false);

  const [aiInstructions, setAiInstructions] = useState({
    system_instructions: "",
    qa_style: "",
    banned_topics: ""
  });

  // Update form fields when business type changes
  const handleBusinessTypeChange = (value: string) => {
    setShowCustomIndustry(value === "other");
    
    const config = industryConfig[value] || industryConfig.other;
    setFormData({
      ...formData,
      business_type: value === "other" ? "" : value,
      voice_style: config.voice_style,
      hours: config.hours,
      services: config.services,
      service_locations: config.service_locations,
    });
  };

  const currentIndustryConfig = industryConfig[formData.business_type] || industryConfig.other;

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
        // Check if business type is a custom one (not in our predefined list)
        const predefinedTypes = ['restaurant', 'clinic', 'gym', 'salon', 'hotel', 'spa'];
        const isCustom = data.business_type && !predefinedTypes.includes(data.business_type);
        setShowCustomIndustry(isCustom);

        setFormData({
          name: data.name || "",
          industry: "",
          custom_industry: "",
          business_type: data.business_type || "",
          voice_style: data.voice_style || "Warm, polite receptionist.",
          hours: data.hours || "Mon-Sun 10:00 – 23:00",
          services: data.services || "",
          branches: data.branches || "Main",
          service_locations: data.service_locations || "",
          currency_prefix: data.currency_prefix || "K",
          twilio_number: data.twilio_number || "",
          whatsapp_number: data.whatsapp_number || "",
          boss_phone: data.boss_phone || "",
          meta_phone_number_id: data.meta_phone_number_id || "",
          meta_business_account_id: data.meta_business_account_id || "",
          whatsapp_voice_enabled: data.whatsapp_voice_enabled || false,
          test_mode: data.test_mode ?? true,
          credit_balance: data.credit_balance || 1000,
          admin_email: "",
          admin_password: "",
          quick_reference_info: data.quick_reference_info || "",
          google_calendar_id: data.google_calendar_id || "",
          calendar_sync_enabled: data.calendar_sync_enabled || false,
          booking_buffer_minutes: data.booking_buffer_minutes || 15
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
            services: formData.services,
            branches: formData.branches,
            currency_prefix: formData.currency_prefix,
            service_locations: formData.service_locations,
            twilio_number: formData.twilio_number,
            whatsapp_number: formData.whatsapp_number,
            boss_phone: formData.boss_phone,
            meta_phone_number_id: formData.meta_phone_number_id || null,
            meta_business_account_id: formData.meta_business_account_id || null,
            whatsapp_voice_enabled: formData.whatsapp_voice_enabled,
            test_mode: formData.test_mode,
            quick_reference_info: formData.quick_reference_info,
            google_calendar_id: formData.google_calendar_id,
            calendar_sync_enabled: formData.calendar_sync_enabled,
            booking_buffer_minutes: formData.booking_buffer_minutes
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
          }, { 
            onConflict: 'company_id',
            ignoreDuplicates: false 
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
              services: formData.services,
              branches: formData.branches,
              currency_prefix: formData.currency_prefix,
              service_locations: formData.service_locations,
              twilio_number: formData.twilio_number,
              whatsapp_number: formData.whatsapp_number,
              boss_phone: formData.boss_phone,
              whatsapp_voice_enabled: formData.whatsapp_voice_enabled,
              test_mode: formData.test_mode,
              credit_balance: formData.credit_balance,
              quick_reference_info: formData.quick_reference_info,
              admin_email: formData.admin_email,
              admin_password: formData.admin_password,
              system_instructions: aiInstructions.system_instructions,
              qa_style: aiInstructions.qa_style,
              banned_topics: aiInstructions.banned_topics,
              google_calendar_id: formData.google_calendar_id,
              calendar_sync_enabled: formData.calendar_sync_enabled,
              booking_buffer_minutes: formData.booking_buffer_minutes
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

  const handleResearchCompany = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Company name required",
        description: "Please enter a company name before researching",
        variant: "destructive",
      });
      return;
    }

    setIsResearching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-company`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            company_name: formData.name,
            industry_hint: formData.business_type || undefined
          }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Research failed');
      }

      setResearchResults(result.data);
      setShowResearchPreview(true);
      
    } catch (error: any) {
      console.error('Research error:', error);
      toast({
        title: "Research failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsResearching(false);
    }
  };

  const applyResearchResults = () => {
    if (!researchResults) return;

    setFormData(prev => ({
      ...prev,
      business_type: researchResults.business_type || prev.business_type,
      voice_style: researchResults.voice_style || prev.voice_style,
      hours: researchResults.hours || prev.hours,
      services: researchResults.services || prev.services,
      branches: researchResults.branches || prev.branches,
      service_locations: researchResults.service_locations || prev.service_locations,
      quick_reference_info: researchResults.quick_reference_info || prev.quick_reference_info,
    }));

    setAiInstructions(prev => ({
      ...prev,
      system_instructions: researchResults.system_instructions || prev.system_instructions,
      qa_style: researchResults.qa_style || prev.qa_style,
      banned_topics: researchResults.banned_topics || prev.banned_topics,
    }));

    // Update industry dropdown if needed
    const predefinedTypes = ['restaurant', 'clinic', 'gym', 'salon', 'hotel', 'spa'];
    if (researchResults.business_type && !predefinedTypes.includes(researchResults.business_type)) {
      setShowCustomIndustry(true);
    }

    setShowResearchPreview(false);
    toast({
      title: "Research applied!",
      description: "Form fields have been populated with AI research results",
    });
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
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Basic Information</h3>
            
            <div>
              <Label htmlFor="name">Company Name *</Label>
              <div className="flex gap-2">
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Your Business Name"
                  required
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResearchCompany}
                  disabled={isResearching || !formData.name.trim()}
                  className="shrink-0"
                >
                  {isResearching ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Researching...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      AI Research
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Enter company name and click "AI Research" to auto-fill fields
              </p>
            </div>

            <div>
              <Label htmlFor="business_type">Business Type *</Label>
              <select
                id="business_type"
                value={showCustomIndustry ? "other" : formData.business_type}
                onChange={(e) => handleBusinessTypeChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="">Select business type...</option>
                <option value="restaurant">Restaurant</option>
                <option value="clinic">Clinic</option>
                <option value="gym">Gym</option>
                <option value="salon">Salon / Spa</option>
                <option value="hotel">Hotel</option>
                <option value="spa">Spa</option>
                <option value="other">Other (Custom)</option>
              </select>
            </div>

            {showCustomIndustry && (
              <div>
                <Label htmlFor="custom_industry">Custom Industry Type *</Label>
                <Input
                  id="custom_industry"
                  value={formData.business_type}
                  onChange={(e) => setFormData({ ...formData, business_type: e.target.value })}
                  placeholder="e.g., bakery, bookstore, car wash"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter your specific industry type
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="voice_style">Voice Style</Label>
              <Textarea
                id="voice_style"
                value={formData.voice_style}
                onChange={(e) => setFormData({ ...formData, voice_style: e.target.value })}
                placeholder="Describe how the AI should speak..."
                className="min-h-[80px]"
              />
            </div>

            <div>
              <Label htmlFor="hours">Hours of Operation</Label>
              <Input
                id="hours"
                value={formData.hours}
                onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                placeholder={currentIndustryConfig.hours}
              />
            </div>

            <div>
              <Label htmlFor="services">{currentIndustryConfig.services_label || 'Services'}</Label>
              <Textarea
                id="services"
                value={formData.services}
                onChange={(e) => setFormData({ ...formData, services: e.target.value })}
                placeholder={currentIndustryConfig.services}
                className="min-h-[100px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="branches">Branches</Label>
                <Input
                  id="branches"
                  value={formData.branches}
                  onChange={(e) => setFormData({ ...formData, branches: e.target.value })}
                  placeholder="Main, Downtown"
                />
              </div>

              <div>
                <Label htmlFor="currency_prefix">Currency</Label>
                <Input
                  id="currency_prefix"
                  value={formData.currency_prefix}
                  onChange={(e) => setFormData({ ...formData, currency_prefix: e.target.value })}
                  placeholder="K, $, €"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="service_locations">{currentIndustryConfig.locations_label || 'Service Locations'}</Label>
              <Input
                id="service_locations"
                value={formData.service_locations}
                onChange={(e) => setFormData({ ...formData, service_locations: e.target.value })}
                placeholder={currentIndustryConfig.service_locations}
              />
            </div>

            <div>
              <Label htmlFor="quick_reference_info">Knowledge Base (optional)</Label>
              <Textarea
                id="quick_reference_info"
                value={formData.quick_reference_info}
                onChange={(e) => setFormData({ ...formData, quick_reference_info: e.target.value })}
                placeholder="Add important information about your business that the AI should know..."
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                This information will be available to the AI when answering customer questions
              </p>
            </div>
          </div>

          {/* Contact Numbers */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Contact Information</h3>

            <div>
              <Label htmlFor="twilio_number">Phone Number (PSTN)</Label>
              <Input
                id="twilio_number"
                value={formData.twilio_number}
                onChange={(e) => setFormData({ ...formData, twilio_number: e.target.value })}
                placeholder="+1234567890"
              />
            </div>

            <div>
              <Label htmlFor="whatsapp_number">WhatsApp Number</Label>
              <Input
                id="whatsapp_number"
                value={formData.whatsapp_number}
                onChange={(e) => setFormData({ ...formData, whatsapp_number: e.target.value })}
                placeholder="whatsapp:+1234567890"
              />
            </div>

            <div>
              <Label htmlFor="boss_phone">Boss/Manager Phone (for notifications)</Label>
              <Input
                id="boss_phone"
                value={formData.boss_phone}
                onChange={(e) => setFormData({ ...formData, boss_phone: e.target.value })}
                placeholder="whatsapp:+1234567890"
              />
            </div>

            <div>
              <Label htmlFor="meta_phone_number_id">Meta WhatsApp Phone Number ID</Label>
              <Input
                id="meta_phone_number_id"
                value={formData.meta_phone_number_id}
                onChange={(e) => setFormData({ ...formData, meta_phone_number_id: e.target.value })}
                placeholder="123456789012345"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Phone Number ID from Meta Business Suite for WhatsApp Cloud API
              </p>
            </div>

            <div>
              <Label htmlFor="meta_business_account_id">Meta Business Account ID</Label>
              <Input
                id="meta_business_account_id"
                value={formData.meta_business_account_id}
                onChange={(e) => setFormData({ ...formData, meta_business_account_id: e.target.value })}
                placeholder="123456789012345"
              />
              <p className="text-xs text-muted-foreground mt-1">
                WhatsApp Business Account ID from Meta Business Suite
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="whatsapp_voice_enabled"
                checked={formData.whatsapp_voice_enabled}
                onChange={(e) => setFormData({ ...formData, whatsapp_voice_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="whatsapp_voice_enabled" className="font-normal">
                Enable WhatsApp voice calls
              </Label>
            </div>

            <div className="space-y-2 p-4 border border-border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="test_mode" className="text-base font-semibold">AI Mode</Label>
                  <p className="text-sm text-muted-foreground">
                    {formData.test_mode 
                      ? "🧪 Test Mode: Boss notifications are logged but not sent" 
                      : "🚀 Production Mode: Boss notifications are sent to WhatsApp"}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-muted-foreground">Test</span>
                  <input
                    type="checkbox"
                    id="test_mode"
                    checked={!formData.test_mode}
                    onChange={(e) => setFormData({ ...formData, test_mode: !e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-muted-foreground">Production</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                ⚠️ Toggle to production mode only when you're ready to receive real boss notifications
              </p>
            </div>
          </div>

          {/* Google Calendar Integration */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Google Calendar Integration</h3>
              
            <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="calendar_sync_enabled"
                  checked={formData.calendar_sync_enabled}
                  onChange={(e) => setFormData({ ...formData, calendar_sync_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="calendar_sync_enabled" className="font-normal">
                  Enable calendar sync for reservations
                </Label>
              </div>

              <div>
                <Label htmlFor="google_calendar_id">Google Calendar ID</Label>
                <Input
                  id="google_calendar_id"
                  value={formData.google_calendar_id}
                  onChange={(e) => setFormData({ ...formData, google_calendar_id: e.target.value })}
                  placeholder="your-calendar@gmail.com"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Calendar ID from Google Calendar settings (typically your email)
                </p>
              </div>

              <div>
                <Label htmlFor="booking_buffer_minutes">Booking Buffer (minutes)</Label>
                <Input
                  type="number"
                  id="booking_buffer_minutes"
                  value={formData.booking_buffer_minutes}
                  onChange={(e) => setFormData({ ...formData, booking_buffer_minutes: parseInt(e.target.value) || 15 })}
                  min="0"
                  max="60"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Time buffer before/after reservations to prevent back-to-back bookings
                </p>
              </div>
          </div>

          {/* AI Instructions */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">AI Assistant Instructions</h3>
            
            <div>
              <Label htmlFor="system_instructions">Custom System Instructions</Label>
              <Textarea
                id="system_instructions"
                value={aiInstructions.system_instructions}
                onChange={(e) => setAiInstructions({ ...aiInstructions, system_instructions: e.target.value })}
                placeholder="Add any specific instructions or context for the AI..."
                className="min-h-[100px]"
              />
            </div>

            <div>
              <Label htmlFor="qa_style">Answer Style</Label>
              <Textarea
                id="qa_style"
                value={aiInstructions.qa_style}
                onChange={(e) => setAiInstructions({ ...aiInstructions, qa_style: e.target.value })}
                placeholder="How should the AI answer questions? (e.g., Be brief and to the point)"
                className="min-h-[80px]"
              />
            </div>

            <div>
              <Label htmlFor="banned_topics">Topics to Avoid</Label>
              <Textarea
                id="banned_topics"
                value={aiInstructions.banned_topics}
                onChange={(e) => setAiInstructions({ ...aiInstructions, banned_topics: e.target.value })}
                placeholder="List topics the AI should not discuss..."
                className="min-h-[80px]"
              />
            </div>
          </div>

          {/* Admin Account (only for new companies) */}
          {!companyId && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Admin Account</h3>
              
              <div>
                <Label htmlFor="admin_email">Admin Email *</Label>
                <Input
                  id="admin_email"
                  type="email"
                  value={formData.admin_email}
                  onChange={(e) => setFormData({ ...formData, admin_email: e.target.value })}
                  placeholder="admin@company.com"
                  required
                />
              </div>

              <div>
                <Label htmlFor="admin_password">Admin Password *</Label>
                <Input
                  id="admin_password"
                  type="password"
                  value={formData.admin_password}
                  onChange={(e) => setFormData({ ...formData, admin_password: e.target.value })}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              <div>
                <Label htmlFor="credit_balance">Initial Credit Balance</Label>
                <Input
                  id="credit_balance"
                  type="number"
                  value={formData.credit_balance}
                  onChange={(e) => setFormData({ ...formData, credit_balance: parseInt(e.target.value) || 0 })}
                  placeholder="1000"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : companyId ? "Update Company" : "Create Company"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>

        {/* Research Results Preview Dialog */}
        <Dialog open={showResearchPreview} onOpenChange={setShowResearchPreview}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Research Results for "{formData.name}"
              </DialogTitle>
              <DialogDescription>
                Review the researched information before applying to your form
              </DialogDescription>
            </DialogHeader>
            
            {researchResults && (
              <div className="space-y-4">
                {/* Confidence Score */}
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Confidence Score</p>
                    <p className="text-xs text-muted-foreground">
                      {researchResults.confidence_score >= 80 ? "Verified company data" : 
                       researchResults.confidence_score >= 50 ? "Estimated from industry standards" : 
                       "Generic industry defaults"}
                    </p>
                  </div>
                  <div className="text-2xl font-bold text-primary">
                    {researchResults.confidence_score}%
                  </div>
                </div>

                {/* Research Summary */}
                {researchResults.research_summary && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <p className="text-sm font-medium mb-1">Research Summary</p>
                    <p className="text-sm text-muted-foreground">{researchResults.research_summary}</p>
                  </div>
                )}

                {/* Field Preview */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Fields to be populated:</h4>
                  
                  {researchResults.business_type && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Business Type</p>
                        <p className="text-sm text-muted-foreground">{researchResults.business_type}</p>
                      </div>
                    </div>
                  )}
                  
                  {researchResults.voice_style && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Voice Style</p>
                        <p className="text-sm text-muted-foreground">{researchResults.voice_style}</p>
                      </div>
                    </div>
                  )}
                  
                  {researchResults.hours && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Operating Hours</p>
                        <p className="text-sm text-muted-foreground">{researchResults.hours}</p>
                      </div>
                    </div>
                  )}
                  
                  {researchResults.services && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Services</p>
                        <p className="text-sm text-muted-foreground">{researchResults.services}</p>
                      </div>
                    </div>
                  )}
                  
                  {researchResults.quick_reference_info && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Knowledge Base</p>
                        <p className="text-sm text-muted-foreground line-clamp-3">{researchResults.quick_reference_info}</p>
                      </div>
                    </div>
                  )}
                  
                  {researchResults.system_instructions && (
                    <div className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">AI System Instructions</p>
                        <p className="text-sm text-muted-foreground line-clamp-3">{researchResults.system_instructions}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowResearchPreview(false)}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={applyResearchResults}>
                <Check className="h-4 w-4 mr-2" />
                Apply All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default CompanyForm;
