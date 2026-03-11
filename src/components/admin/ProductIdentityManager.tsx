import { useState, useEffect } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Fingerprint,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Eye,
  EyeOff,
  Trash2,
  Scan,
  Package,
  Palette,
  Tag,
  ShieldCheck,
  Ban,
} from 'lucide-react';

interface ColorEntry {
  hex: string;
  name: string;
  location: string;
}

interface VisualFingerprint {
  colors?: ColorEntry[];
  labels?: string[];
  shape?: string;
  distinguishing_features?: string[];
  logo_description?: string;
  packaging_type?: string;
  surface_finish?: string;
  size_impression?: string;
}

interface ProductProfile {
  id: string;
  company_id: string;
  media_id: string | null;
  product_name: string;
  visual_fingerprint: VisualFingerprint;
  exclusion_keywords: string[];
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface MediaAsset {
  id: string;
  file_name: string;
  file_path: string;
  description: string | null;
  tags: string[] | null;
  category: string;
}

export const ProductIdentityManager = () => {
  const { selectedCompany } = useCompany();
  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<ProductProfile | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null); // profile id being analyzed
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);

  // Create form state
  const [newProductName, setNewProductName] = useState('');
  const [newMediaId, setNewMediaId] = useState<string>('');
  const [newExclusionKeyword, setNewExclusionKeyword] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit exclusion state
  const [editExclusion, setEditExclusion] = useState('');

  useEffect(() => {
    if (selectedCompany) loadData();
  }, [selectedCompany]);

  const loadData = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const [profilesRes, mediaRes] = await Promise.all([
        supabase
          .from('product_identity_profiles')
          .select('*')
          .eq('company_id', selectedCompany.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('company_media')
          .select('id, file_name, file_path, description, tags, category')
          .eq('company_id', selectedCompany.id)
          .eq('category', 'products')
          .eq('media_type', 'image')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      // Cast the data since types.ts may not have this table yet
      setProfiles((profilesRes.data as any[] || []) as ProductProfile[]);
      setMediaAssets(mediaRes.data || []);
    } catch (error) {
      console.error('Error loading product profiles:', error);
      toast.error('Failed to load product profiles');
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = (filePath: string) => {
    const { data } = supabase.storage.from('company-media').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const getMediaForProfile = (profile: ProductProfile): MediaAsset | undefined => {
    if (!profile.media_id) return undefined;
    return mediaAssets.find(m => m.id === profile.media_id);
  };

  const analyzeProduct = async (mediaAsset: MediaAsset, productName: string, profileId?: string) => {
    if (!selectedCompany) return;
    const analyzeId = profileId || mediaAsset.id;
    setAnalyzing(analyzeId);

    try {
      const imageUrl = getImageUrl(mediaAsset.file_path);
      const { data, error } = await supabase.functions.invoke('extract-product-identity', {
        body: {
          imageUrl,
          mediaId: mediaAsset.id,
          companyId: selectedCompany.id,
          productName,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success(`Product identity extracted for "${productName}"`);
      await loadData();

      // Update selected profile if in detail view
      if (selectedProfile && data.profile) {
        setSelectedProfile(data.profile as ProductProfile);
      }
    } catch (error) {
      console.error('Error analyzing product:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to analyze product');
    } finally {
      setAnalyzing(null);
    }
  };

  const createProfile = async () => {
    if (!selectedCompany || !newProductName.trim()) return;
    setCreating(true);

    try {
      const selectedMedia = mediaAssets.find(m => m.id === newMediaId);
      
      if (selectedMedia) {
        // Auto-analyze with vision
        await analyzeProduct(selectedMedia, newProductName.trim());
      } else {
        // Manual creation without image
        const { error } = await supabase
          .from('product_identity_profiles')
          .insert({
            company_id: selectedCompany.id,
            product_name: newProductName.trim(),
            visual_fingerprint: {},
            exclusion_keywords: [],
            is_active: true,
          } as any);

        if (error) throw error;
        toast.success('Product profile created');
        await loadData();
      }

      setShowCreateDialog(false);
      setNewProductName('');
      setNewMediaId('');
    } catch (error) {
      console.error('Error creating profile:', error);
      toast.error('Failed to create profile');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (profile: ProductProfile) => {
    try {
      const { error } = await supabase
        .from('product_identity_profiles')
        .update({ is_active: !profile.is_active } as any)
        .eq('id', profile.id);

      if (error) throw error;
      setProfiles(prev =>
        prev.map(p => p.id === profile.id ? { ...p, is_active: !p.is_active } : p)
      );
      if (selectedProfile?.id === profile.id) {
        setSelectedProfile({ ...profile, is_active: !profile.is_active });
      }
    } catch (error) {
      toast.error('Failed to update profile');
    }
  };

  const deleteProfile = async (profile: ProductProfile) => {
    try {
      const { error } = await supabase
        .from('product_identity_profiles')
        .delete()
        .eq('id', profile.id);

      if (error) throw error;
      toast.success('Profile deleted');
      setProfiles(prev => prev.filter(p => p.id !== profile.id));
      setShowDetailDialog(false);
    } catch (error) {
      toast.error('Failed to delete profile');
    }
  };

  const addExclusionKeyword = async (profile: ProductProfile, keyword: string) => {
    if (!keyword.trim()) return;
    const updated = [...(profile.exclusion_keywords || []), keyword.trim()];
    try {
      const { error } = await supabase
        .from('product_identity_profiles')
        .update({ exclusion_keywords: updated } as any)
        .eq('id', profile.id);

      if (error) throw error;
      const updatedProfile = { ...profile, exclusion_keywords: updated };
      setProfiles(prev => prev.map(p => p.id === profile.id ? updatedProfile : p));
      setSelectedProfile(updatedProfile);
      setEditExclusion('');
    } catch (error) {
      toast.error('Failed to add exclusion keyword');
    }
  };

  const removeExclusionKeyword = async (profile: ProductProfile, keyword: string) => {
    const updated = (profile.exclusion_keywords || []).filter(k => k !== keyword);
    try {
      const { error } = await supabase
        .from('product_identity_profiles')
        .update({ exclusion_keywords: updated } as any)
        .eq('id', profile.id);

      if (error) throw error;
      const updatedProfile = { ...profile, exclusion_keywords: updated };
      setProfiles(prev => prev.map(p => p.id === profile.id ? updatedProfile : p));
      setSelectedProfile(updatedProfile);
    } catch (error) {
      toast.error('Failed to remove keyword');
    }
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to manage product identities
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  const fp = selectedProfile?.visual_fingerprint || {};
  const colors = (fp.colors || []) as ColorEntry[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            Product Identity Profiles
          </h3>
          <p className="text-sm text-muted-foreground">
            Visual fingerprints ensure AI generates the correct product every time
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Empty State */}
      {profiles.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <Fingerprint className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No product profiles yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Create identity profiles from your product images. The AI will extract exact colors, 
              labels, and shapes to ensure accurate image generation — no more cross-company contamination.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Profile
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Product Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map(profile => {
            const media = getMediaForProfile(profile);
            const pfp = (profile.visual_fingerprint || {}) as VisualFingerprint;
            const pColors = (pfp.colors || []) as ColorEntry[];

            return (
              <Card
                key={profile.id}
                className={`group cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30 ${
                  !profile.is_active ? 'opacity-60' : ''
                }`}
                onClick={() => {
                  setSelectedProfile(profile);
                  setShowDetailDialog(true);
                }}
              >
                <CardContent className="p-0">
                  {/* Image */}
                  <div className="relative aspect-[4/3] bg-muted rounded-t-lg overflow-hidden">
                    {media ? (
                      <img
                        src={getImageUrl(media.file_path)}
                        alt={profile.product_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-10 w-10 text-muted-foreground/40" />
                      </div>
                    )}
                    {/* Status badge */}
                    <div className="absolute top-2 right-2">
                      <Badge
                        variant={profile.is_active ? 'default' : 'secondary'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {profile.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {/* Analyzing overlay */}
                    {analyzing === profile.id && (
                      <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <h4 className="font-medium text-sm truncate">{profile.product_name}</h4>

                    {/* Color Swatches */}
                    {pColors.length > 0 && (
                      <div className="flex items-center gap-1">
                        {pColors.slice(0, 6).map((c, i) => (
                          <div
                            key={i}
                            className="h-4 w-4 rounded-full border border-border shadow-sm"
                            style={{ backgroundColor: c.hex }}
                            title={`${c.name}: ${c.hex}`}
                          />
                        ))}
                        {pColors.length > 6 && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            +{pColors.length - 6}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Exclusion count */}
                    {(profile.exclusion_keywords || []).length > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Ban className="h-3 w-3" />
                        {profile.exclusion_keywords.length} exclusion{profile.exclusion_keywords.length !== 1 ? 's' : ''}
                      </div>
                    )}

                    {/* Shape tag */}
                    {pfp.packaging_type && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {pfp.packaging_type}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="h-5 w-5 text-primary" />
              {selectedProfile?.product_name}
            </DialogTitle>
            <DialogDescription>
              Visual identity profile — used as hard constraints in image generation
            </DialogDescription>
          </DialogHeader>

          {selectedProfile && (
            <ScrollArea className="flex-1 max-h-[60vh]">
              <div className="space-y-6 pr-4">
                {/* Product Image */}
                {(() => {
                  const media = getMediaForProfile(selectedProfile);
                  return media ? (
                    <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                      <img
                        src={getImageUrl(media.file_path)}
                        alt={selectedProfile.product_name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : null;
                })()}

                {/* Color Palette */}
                {colors.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Palette className="h-4 w-4 text-primary" />
                      Color Palette
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {colors.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5"
                        >
                          <div
                            className="h-5 w-5 rounded-full border shadow-sm"
                            style={{ backgroundColor: c.hex }}
                          />
                          <div className="text-xs">
                            <span className="font-mono font-medium">{c.hex}</span>
                            <span className="text-muted-foreground ml-1.5">{c.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Labels */}
                {fp.labels && fp.labels.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Tag className="h-4 w-4 text-primary" />
                      Label Text
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {fp.labels.map((label: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          "{label}"
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shape & Packaging */}
                {fp.shape && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Package className="h-4 w-4 text-primary" />
                      Shape & Packaging
                    </Label>
                    <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                      {fp.shape}
                    </p>
                    <div className="flex gap-2">
                      {fp.packaging_type && (
                        <Badge variant="outline" className="text-xs">{fp.packaging_type}</Badge>
                      )}
                      {fp.surface_finish && (
                        <Badge variant="outline" className="text-xs">{fp.surface_finish}</Badge>
                      )}
                      {fp.size_impression && (
                        <Badge variant="outline" className="text-xs">{fp.size_impression}</Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Distinguishing Features */}
                {fp.distinguishing_features && fp.distinguishing_features.length > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Distinguishing Features
                    </Label>
                    <ul className="space-y-1">
                      {fp.distinguishing_features.map((f: string, i: number) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-primary mt-1">•</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Logo Description */}
                {fp.logo_description && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Logo</Label>
                    <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                      {fp.logo_description}
                    </p>
                  </div>
                )}

                {/* Exclusion Keywords */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Ban className="h-4 w-4 text-destructive" />
                    Exclusion Keywords
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Brand names or product names that must NEVER appear in generated images for this company
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedProfile.exclusion_keywords || []).map((kw, i) => (
                      <Badge
                        key={i}
                        variant="destructive"
                        className="text-xs cursor-pointer gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeExclusionKeyword(selectedProfile, kw);
                        }}
                      >
                        {kw}
                        <X className="h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add exclusion keyword..."
                      value={editExclusion}
                      onChange={(e) => setEditExclusion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addExclusionKeyword(selectedProfile, editExclusion);
                        }
                      }}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addExclusionKeyword(selectedProfile, editExclusion)}
                      disabled={!editExclusion.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {/* Active Toggle */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    {selectedProfile.is_active ? (
                      <Eye className="h-4 w-4 text-primary" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {selectedProfile.is_active ? 'Active — Used in generation' : 'Inactive — Excluded from generation'}
                    </span>
                  </div>
                  <Switch
                    checked={selectedProfile.is_active}
                    onCheckedChange={() => toggleActive(selectedProfile)}
                  />
                </div>
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex-row justify-between gap-2 pt-4 border-t">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => selectedProfile && deleteProfile(selectedProfile)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
            <div className="flex gap-2">
              {selectedProfile && getMediaForProfile(selectedProfile) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const media = getMediaForProfile(selectedProfile);
                    if (media) analyzeProduct(media, selectedProfile.product_name, selectedProfile.id);
                  }}
                  disabled={analyzing === selectedProfile?.id}
                >
                  {analyzing === selectedProfile?.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Scan className="h-4 w-4 mr-1" />
                  )}
                  Re-analyze
                </Button>
              )}
              <Button size="sm" onClick={() => setShowDetailDialog(false)}>
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              New Product Profile
            </DialogTitle>
            <DialogDescription>
              Select a product image and name. AI vision will automatically extract the visual identity.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input
                placeholder="e.g. LifeStraw Community"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Product Image (from Brand Assets)</Label>
              {mediaAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No product images found. Upload products in the Brand Assets section first.
                </p>
              ) : (
                <Select value={newMediaId} onValueChange={setNewMediaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a product image..." />
                  </SelectTrigger>
                  <SelectContent>
                    {mediaAssets.map(asset => (
                      <SelectItem key={asset.id} value={asset.id}>
                        <div className="flex items-center gap-2">
                          <img
                            src={getImageUrl(asset.file_path)}
                            alt={asset.file_name}
                            className="h-6 w-6 rounded object-cover"
                          />
                          <span className="truncate">{asset.description || asset.file_name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Preview */}
              {newMediaId && (() => {
                const asset = mediaAssets.find(m => m.id === newMediaId);
                return asset ? (
                  <div className="relative aspect-video bg-muted rounded-lg overflow-hidden mt-2">
                    <img
                      src={getImageUrl(asset.file_path)}
                      alt={asset.file_name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : null;
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={createProfile}
              disabled={!newProductName.trim() || creating}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Scan className="h-4 w-4 mr-1" />
              )}
              {newMediaId ? 'Analyze & Create' : 'Create Profile'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
