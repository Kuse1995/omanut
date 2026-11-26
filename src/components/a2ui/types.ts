export type StudioTab = 'vault' | 'prioritize' | 'calendar' | 'studio' | 'connect' | 'brand';

export interface StudioSessionInfo {
  id: string;
  surface_type: string;
  ui_spec: {
    headline?: string | null;
    highlighted_asset_ids?: string[];
    suggested_note?: string | null;
  };
  status: 'active' | 'submitted' | 'expired';
  expires_at: string;
}

export interface StudioCompany {
  id: string;
  name: string;
  business_type: string | null;
  services: string | null;
  hours: string | null;
}

export interface StudioBrandKit {
  logo_url: string | null;
  colors: Record<string, string> | null;
  tone: string | null;
  guidelines: string | null;
  no_go_phrases: string | null;
}

export interface StudioImageSettings {
  enabled: boolean;
  brand_tone: string | null;
  brand_colors: Record<string, string> | null;
  style_description: string | null;
  visual_guidelines: string | null;
}

export interface StudioSubscription {
  id: string;
  status: string;
  autopilot_level: 'copilot' | 'weekly_batch' | 'full_autopilot';
  usage_posts_used: number;
  monthly_posts_limit: number;
  usage_images_used: number;
  monthly_images_limit: number;
  usage_videos_used: number;
  monthly_videos_limit: number;
  current_period_end: string;
  currency: string;
  monthly_fee_amount: number;
}

export interface VaultAsset {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  media_type: 'image' | 'video';
  category: string;
  description: string | null;
  tags: string[] | null;
  vault_status: 'raw' | 'ready' | 'scheduled' | 'posted' | 'evergreen' | 'archived';
  source_channel: string;
  quality_score: number | null;
  ai_hook_suggestions: string[];
  recommended_format: string | null;
  times_posted: number;
  last_posted_at: string | null;
  priority_rank: number | null;
  created_at: string;
  url: string;
}

export interface StudioScheduledPost {
  id: string;
  content: string;
  target_platform: string;
  scheduled_time: string;
  status: string;
  image_url: string | null;
  image_urls: string[] | null;
  video_url: string | null;
  page_id: string;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

export interface StudioCreatives {
  images: Array<{
    id: string;
    prompt: string;
    image_url: string;
    status: string;
    created_at: string;
  }>;
  videos: Array<{
    id: string;
    prompt: string | null;
    video_url: string | null;
    status: string;
    aspect_ratio: string | null;
    created_at: string;
  }>;
}

export interface StudioConnections {
  meta: Array<{
    id: string;
    page_id: string;
    page_name: string | null;
    page_picture_url: string | null;
    ig_user_id: string | null;
    health_status: string;
    last_verified_at: string | null;
  }>;
  meta_app_id: string | null;
  meta_config_id: string | null;
  tiktok: {
    id: string;
    account_id: string;
    account_name: string | null;
    token_expires_at: string | null;
  } | null;
  linkedin: {
    id: string;
    account_id: string;
    account_name: string | null;
    account_type: string | null;
    token_expires_at: string | null;
  } | null;
}

export interface StudioLoadResponse {
  ok: boolean;
  session: StudioSessionInfo;
  company: StudioCompany;
  brand_kit: StudioBrandKit | null;
  image_settings: StudioImageSettings | null;
  subscription: StudioSubscription | null;
  vault: VaultAsset[];
  scheduled_posts: StudioScheduledPost[];
  recent_creatives: StudioCreatives;
  connections: StudioConnections;
}

export type CallA2UIFn = <T = Record<string, unknown>>(
  action: string,
  payload?: Record<string, unknown>
) => Promise<T>;
