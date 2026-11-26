import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Calendar,
  FolderOpen,
  ListOrdered,
  Palette,
  Share2,
  Sparkles,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import type { CallA2UIFn, StudioLoadResponse, StudioTab } from '@/components/a2ui/types';
import { VaultUploaderSurface } from '@/components/a2ui/VaultUploaderSurface';
import { VaultPrioritizerSurface } from '@/components/a2ui/VaultPrioritizerSurface';
import { CalendarGridSurface } from '@/components/a2ui/CalendarGridSurface';
import { CreativeStudioSurface } from '@/components/a2ui/CreativeStudioSurface';
import { ConnectHubSurface } from '@/components/a2ui/ConnectHubSurface';
import { BrandDnaSurface } from '@/components/a2ui/BrandDnaSurface';

const VALID_TABS: StudioTab[] = ['vault', 'prioritize', 'calendar', 'studio', 'connect', 'brand'];

function mapSurfaceToTab(surface?: string): StudioTab {
  switch (surface) {
    case 'vault_prioritizer':
      return 'prioritize';
    case 'calendar_grid':
      return 'calendar';
    case 'creative_studio':
      return 'studio';
    case 'connect_hub':
    case 'onboarding_hub':
      return 'connect';
    case 'brand_dna':
      return 'brand';
    default:
      return 'vault';
  }
}

export default function MobileStudio() {
  const { token = '' } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<StudioLoadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tabParam = searchParams.get('tab') as StudioTab | null;
  const metaCode = searchParams.get('meta_code');
  const metaError = searchParams.get('meta_error');

  const [activeTab, setActiveTab] = useState<StudioTab>(() =>
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'vault'
  );

  const callA2UI: CallA2UIFn = useCallback(
    async <T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
      const { data: res, error } = await supabase.functions.invoke('a2ui-session', {
        body: { token, action, ...payload },
      });
      if (error || res?.error) {
        throw new Error(res?.error || error?.message || 'Studio request failed');
      }
      return res as T;
    },
    [token]
  );

  const loadStudio = useCallback(async () => {
    try {
      const res = await callA2UI<StudioLoadResponse>('load');
      setData(res);
      setErrorMsg(null);
      if (!tabParam || !VALID_TABS.includes(tabParam)) {
        setActiveTab(mapSurfaceToTab(res.session?.surface_type));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to open Mobile Studio');
    } finally {
      setLoading(false);
    }
  }, [callA2UI, tabParam]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  const clearMetaParams = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('meta_code');
    next.delete('meta_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const switchTab = (tab: StudioTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Opening your Omanut Marketer Studio…</p>
      </div>
    );
  }

  if (errorMsg || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <h2 className="text-lg font-semibold">Studio Link Unavailable</h2>
            <p className="text-sm text-muted-foreground">
              {errorMsg || 'This link has expired or is invalid. Ask your Omanut Marketer on WhatsApp for a fresh link.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const accentColor = data.brand_kit?.colors?.primary || '#10B981';
  const navItems: Array<{ id: StudioTab; label: string; icon: typeof FolderOpen }> = [
    { id: 'vault', label: 'Vault', icon: FolderOpen },
    { id: 'prioritize', label: 'Pick Order', icon: ListOrdered },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'studio', label: 'AI Studio', icon: Sparkles },
    { id: 'connect', label: 'Channels', icon: Share2 },
    { id: 'brand', label: 'Brand DNA', icon: Palette },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {data.brand_kit?.logo_url ? (
              <img src={data.brand_kit.logo_url} alt="" className="w-9 h-9 rounded-xl object-cover border" />
            ) : (
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: accentColor }}
              >
                {data.company.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">{data.company.name}</h1>
              <p className="text-[11px] text-muted-foreground truncate">Omanut WhatsApp Marketer Studio</p>
            </div>
          </div>

          {data.subscription && (
            <Badge variant="secondary" className="text-[11px] shrink-0">
              Posts {data.subscription.usage_posts_used}/{data.subscription.monthly_posts_limit}
            </Badge>
          )}
        </div>

        <div className="max-w-2xl mx-auto px-3 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/70 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {data.session.ui_spec?.headline && (
          <div className="rounded-xl border bg-primary/5 border-primary/25 px-3.5 py-2.5 text-xs text-foreground">
            <span className="font-semibold">Marketer Note: </span>
            {data.session.ui_spec.headline}
          </div>
        )}

        {activeTab === 'vault' && (
          <VaultUploaderSurface
            vault={data.vault}
            callA2UI={callA2UI}
            onRefresh={loadStudio}
            onSwitchTab={switchTab}
          />
        )}

        {activeTab === 'prioritize' && (
          <VaultPrioritizerSurface
            vault={data.vault}
            suggestedNote={data.session.ui_spec?.suggested_note}
            callA2UI={callA2UI}
            onRefresh={loadStudio}
            onSwitchTab={switchTab}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarGridSurface
            posts={data.scheduled_posts}
            callA2UI={callA2UI}
            onRefresh={loadStudio}
          />
        )}

        {activeTab === 'studio' && (
          <CreativeStudioSurface
            creatives={data.recent_creatives}
            callA2UI={callA2UI}
          />
        )}

        {activeTab === 'connect' && (
          <ConnectHubSurface
            token={token}
            companyId={data.company.id}
            companyName={data.company.name}
            connections={data.connections}
            initialMetaCode={metaCode}
            initialMetaError={metaError}
            onClearMetaParams={clearMetaParams}
            callA2UI={callA2UI}
            onRefresh={loadStudio}
          />
        )}

        {activeTab === 'brand' && (
          <BrandDnaSurface
            brandKit={data.brand_kit}
            imageSettings={data.image_settings}
            subscription={data.subscription}
            callA2UI={callA2UI}
            onRefresh={loadStudio}
          />
        )}
      </main>
    </div>
  );
}
