import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, Image as ImageIcon, Video, Link2 } from "lucide-react";

interface BmsProduct {
  id?: string;
  name?: string;
  product_name?: string;
  sku?: string;
  price?: number;
  selling_price?: number;
}

interface CompanyMediaProps {
  companyId: string;
}

interface Media {
  id: string;
  bms_product_id: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  media_type: string;
  description: string | null;
  tags: string[];
  created_at: string;
  thumbnail_url: string | null;
  category: string;
  signed_url?: string;
  signed_thumb_url?: string;
}

type MediaCategory = 'products' | 'interior' | 'exterior' | 'logo' | 'promotional' | 'staff' | 'events' | 'facilities' | 'other';

const MEDIA_CATEGORIES: { value: MediaCategory; label: string; description: string }[] = [
  { value: 'products', label: '📋 Products/Services', description: 'Product photos, services, offerings' },
  { value: 'interior', label: '🏢 Interior', description: 'Indoor spaces, work areas' },
  { value: 'exterior', label: '🏛️ Exterior', description: 'Building exterior, entrance' },
  { value: 'logo', label: '🎨 Logo', description: 'Company logos, branding' },
  { value: 'promotional', label: '🎉 Promotional', description: 'Posters, flyers, special offers' },
  { value: 'staff', label: '👥 Staff', description: 'Team photos' },
  { value: 'events', label: '🎊 Events', description: 'Past events, gatherings' },
  { value: 'facilities', label: '🏊 Facilities', description: 'Amenities and equipment' },
  { value: 'other', label: '📁 Other', description: 'Miscellaneous media' },
];

export default function CompanyMedia({ companyId }: CompanyMediaProps) {
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory>('other');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const { toast } = useToast();

  // BMS products state
  const [bmsProducts, setBmsProducts] = useState<BmsProduct[]>([]);
  const [selectedBmsProductId, setSelectedBmsProductId] = useState('');

  useEffect(() => {
    const fetchBmsProducts = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('bms-agent', {
          body: { action: 'list_products', params: { company_id: companyId } }
        });
        if (!error && data?.success && Array.isArray(data.data)) {
          setBmsProducts(data.data);
        }
      } catch (e) {
        console.log('BMS products not available:', e);
      }
    };
    fetchBmsProducts();
  }, [companyId]);

  useEffect(() => {
    loadMedia();
  }, [companyId]);

  const loadMedia = async () => {
    try {
      const { data, error } = await supabase
        .from('company_media')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Generate signed URLs for all media
      const mediaWithUrls = await Promise.all(
        (data || []).map(async (item) => {
          try {
            const { data: signedData } = await supabase.storage
              .from('company-media')
              .createSignedUrl(item.file_path, 3600); // 1 hour expiry
            
            let signedThumbUrl = undefined;
            if (item.thumbnail_url && item.media_type === 'video') {
              // Extract path from thumbnail URL if it's a full URL
              const thumbPath = item.thumbnail_url.includes('company-media/') 
                ? item.thumbnail_url.split('company-media/')[1] 
                : item.file_path.replace(/\.[^/.]+$/, '_thumb.jpg');
              
              const { data: thumbData } = await supabase.storage
                .from('company-media')
                .createSignedUrl(thumbPath, 3600);
              
              signedThumbUrl = thumbData?.signedUrl;
            }
            
            return {
              ...item,
              signed_url: signedData?.signedUrl,
              signed_thumb_url: signedThumbUrl
            };
          } catch (urlError) {
            console.error('Error generating signed URL:', urlError);
            return item;
          }
        })
      );
      
      setMedia(mediaWithUrls);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const generateVideoThumbnail = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      
      video.onloadedmetadata = () => {
        video.currentTime = 1; // Capture frame at 1 second
      };
      
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create thumbnail'));
          }
        }, 'image/jpeg', 0.8);
      };
      
      video.onerror = () => {
        reject(new Error('Failed to load video'));
      };
      
      video.src = URL.createObjectURL(file);
    });
  };

  const compressVideo = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      video.onloadedmetadata = () => {
        // Reduce resolution if video is large
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
        
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        
        const chunks: BlobPart[] = [];
        const stream = canvas.captureStream(30); // 30 fps
        
        // Use lower bitrate for compression
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 1000000 // 1 Mbps
        });
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const compressedFile = new File(
            [blob], 
            file.name.replace(/\.[^/.]+$/, '.webm'),
            { type: 'video/webm' }
          );
          resolve(compressedFile);
        };
        
        mediaRecorder.onerror = (e) => {
          reject(new Error('MediaRecorder error: ' + e));
        };
        
        let currentTime = 0;
        const duration = video.duration;
        
        const drawFrame = () => {
          if (currentTime >= duration) {
            mediaRecorder.stop();
            return;
          }
          
          video.currentTime = currentTime;
          currentTime += 1/30; // Advance by frame duration
          
          const progress = Math.min(95, (currentTime / duration) * 100);
          setCompressionProgress(Math.round(progress));
        };
        
        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          if (mediaRecorder.state === 'inactive') {
            mediaRecorder.start();
          }
          
          drawFrame();
        };
        
        video.onerror = () => {
          reject(new Error('Video loading error'));
        };
        
        // Start the process
        video.currentTime = 0;
      };
      
      video.src = URL.createObjectURL(file);
      video.load();
    });
  };

  const analyzeMediaWithAI = async (file: File) => {
    setAnalyzing(true);
    try {
      // Convert file to base64 data URL
      const reader = new FileReader();
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Get company data for context
      const { data: company } = await supabase
        .from('companies')
        .select('business_type')
        .eq('id', companyId)
        .single();

      // Call AI analysis edge function
      const { data, error } = await supabase.functions.invoke('analyze-media', {
        body: {
          imageDataUrl,
          fileName: file.name,
          fileType: file.type,
          businessType: company?.business_type || 'business'
        }
      });

      if (error) throw error;

      if (data && !data.error) {
        setSelectedCategory(data.category as MediaCategory);
        setDescription(data.description);
        setTags(Array.isArray(data.tags) ? data.tags.join(', ') : data.tags);
        setAiSuggested(true);
        
        toast({
          title: "AI Suggestions Ready",
          description: "Review and edit the suggestions before uploading",
        });
      } else if (data?.fallback) {
        setSelectedCategory(data.fallback.category as MediaCategory);
        setDescription(data.fallback.description);
        setTags(data.fallback.tags.join(', '));
      }
    } catch (error: any) {
      console.error('AI analysis error:', error);
      toast({
        title: "AI Analysis Failed",
        description: "You can still upload and add details manually",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 150 * 1024 * 1024; // 150MB
    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: "Maximum file size is 150MB",
        variant: "destructive",
      });
      event.target.value = '';
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      toast({
        title: "Invalid file type",
        description: "Only images and videos are allowed",
        variant: "destructive",
      });
      event.target.value = '';
      return;
    }

    // Check if video needs compression (over 50MB)
    if (isVideo && file.size > 50 * 1024 * 1024) {
      try {
        setCompressing(true);
        setCompressionProgress(0);
        
        toast({
          title: "Compressing video",
          description: "Large video detected. Compressing to optimize upload...",
        });
        
        const compressedFile = await compressVideo(file);
        setCompressionProgress(100);
        
        const savedSize = ((1 - compressedFile.size / file.size) * 100).toFixed(0);
        toast({
          title: "Compression complete",
          description: `Video compressed successfully. Saved ${savedSize}% of space!`,
        });
        
        setSelectedFile(compressedFile);
      } catch (error: any) {
        console.error('Compression error:', error);
        toast({
          title: "Compression failed",
          description: "Uploading original video instead",
          variant: "destructive",
        });
        setSelectedFile(file);
      } finally {
        setCompressing(false);
        setCompressionProgress(0);
      }
    } else {
      // Store the file for later upload
      setSelectedFile(file);

      // Analyze with AI for images
      if (isImage) {
        await analyzeMediaWithAI(file);
      }
    }
  };

  const handleFileUpload = async () => {
    const file = selectedFile;
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a file first",
        variant: "destructive",
      });
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    setUploading(true);
    setUploadProgress(0);

    try {
      console.log('Starting upload for company:', companyId);
      
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) return prev; // Stop at 90% until actual upload completes
          return prev + 10;
        });
      }, 300);
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error('User error:', userError);
        throw new Error('You must be logged in to upload media');
      }
      
      console.log('User authenticated:', user.id);

      const fileExt = file.name.split('.').pop();
      const fileName = `${companyId}/${selectedCategory}/${Date.now()}.${fileExt}`;
      
      console.log('Uploading file:', fileName);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('company-media')
        .upload(fileName, file);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }
      
      console.log('File uploaded successfully:', uploadData);

      let thumbnailUrl = null;
      
      // Generate and upload thumbnail for videos
      if (isVideo) {
        try {
          console.log('Generating video thumbnail...');
          const thumbnailBlob = await generateVideoThumbnail(file);
          const thumbnailFileName = `${companyId}/${selectedCategory}/${Date.now()}_thumb.jpg`;
          
          const { error: thumbUploadError } = await supabase.storage
            .from('company-media')
            .upload(thumbnailFileName, thumbnailBlob);

          if (thumbUploadError) {
            console.error('Thumbnail upload error:', thumbUploadError);
          } else {
            const { data: thumbData } = supabase.storage
              .from('company-media')
              .getPublicUrl(thumbnailFileName);
            thumbnailUrl = thumbData.publicUrl;
            console.log('Thumbnail uploaded successfully');
          }
        } catch (thumbError) {
          console.error('Failed to generate thumbnail:', thumbError);
          // Continue without thumbnail
        }
      }

      console.log('Inserting into database...');
      const { error: dbError } = await supabase
        .from('company_media')
        .insert({
          company_id: companyId,
          file_name: file.name,
          file_path: fileName,
          file_type: file.type,
          file_size: file.size,
          media_type: isImage ? 'image' : 'video',
          description: description || null,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          uploaded_by: user.id,
          thumbnail_url: thumbnailUrl,
          category: selectedCategory
        });

      if (dbError) {
        console.error('Database error:', dbError);
        throw dbError;
      }
      
      console.log('Media record created successfully');

      toast({
        title: "Success",
        description: "Media uploaded successfully",
      });

      setDescription("");
      setTags("");
      setSelectedCategory('other');
      setAiSuggested(false);
      setSelectedFile(null);
      setUploadProgress(0);
      loadMedia();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (mediaItem: Media) => {
    try {
      const { error: storageError } = await supabase.storage
        .from('company-media')
        .remove([mediaItem.file_path]);

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('company_media')
        .delete()
        .eq('id', mediaItem.id);

      if (dbError) throw dbError;

      toast({
        title: "Success",
        description: "Media deleted successfully",
      });

      loadMedia();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };


  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Media Library</CardTitle>
        <CardDescription>
          Upload images and videos that the AI can send to customers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {compressing && (
            <div className="space-y-2 p-4 bg-primary/10 rounded-lg">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">Compressing video...</span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={compressionProgress} className="h-2 flex-1" />
                <span className="text-sm font-medium min-w-[3ch] text-right">{compressionProgress}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                This may take a minute. Optimizing for faster upload and storage efficiency.
              </p>
            </div>
          )}
          
          {analyzing && (
            <div className="flex items-center gap-2 p-4 bg-primary/10 rounded-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">AI is analyzing your media...</span>
            </div>
          )}
          
          {aiSuggested && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <span className="text-sm text-green-700 dark:text-green-300">
                ✨ AI suggestions applied - review and edit as needed
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="file-select">
              1. Select Image or Video
              <span className="ml-2 text-xs text-muted-foreground">(AI will analyze it)</span>
            </Label>
            <Input
              id="file-select"
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              disabled={analyzing || uploading || compressing}
            />
            <p className="text-sm text-muted-foreground">
              Maximum file size: 150MB • Videos over 50MB will be compressed automatically
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">
              2. Media Category
              {aiSuggested && <span className="ml-2 text-xs text-primary">✨ AI suggested</span>}
            </Label>
            <select
              id="category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as MediaCategory)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={analyzing}
            >
              {MEDIA_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.label} - {cat.description}
                </option>
              ))}
            </select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">
              3. Description (optional)
              {aiSuggested && <span className="ml-2 text-xs text-primary">✨ AI suggested</span>}
            </Label>
            <Textarea
              id="description"
              placeholder="Describe what this media shows..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={analyzing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">
              4. Tags (comma-separated, optional)
              {aiSuggested && <span className="ml-2 text-xs text-primary">✨ AI suggested</span>}
            </Label>
            <Input
              id="tags"
              placeholder="menu, food, interior, pool..."
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={analyzing}
            />
          </div>

          <div className="space-y-2">
            <Label>5. Link to BMS Product (optional)</Label>
            <Select value={selectedBmsProductId} onValueChange={setSelectedBmsProductId}>
              <SelectTrigger>
                <SelectValue placeholder={bmsProducts.length === 0 ? 'No BMS products found' : 'Select a BMS product'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No link —</SelectItem>
                {bmsProducts.map((p, i) => {
                  const productId = p.id || p.sku || String(i);
                  const productName = p.name || p.product_name || 'Unknown';
                  return (
                    <SelectItem key={productId} value={productId}>
                      {productName}{p.sku ? ` (${p.sku})` : ''}{p.price || p.selling_price ? ` — ${p.price || p.selling_price}` : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {uploading && uploadProgress > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
          
          <Button
            onClick={handleFileUpload}
            disabled={analyzing || uploading || compressing || !selectedFile}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                5. Upload Media
              </>
            )}
          </Button>
          
          {!analyzing && !aiSuggested && (
            <p className="text-xs text-muted-foreground text-center">
              Select a file to get AI-powered suggestions
            </p>
          )}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : media.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No media uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-6">
              {MEDIA_CATEGORIES.map(category => {
                const categoryMedia = media.filter(m => m.category === category.value);
                if (categoryMedia.length === 0) return null;
                
                return (
                  <div key={category.value} className="space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span>{category.label}</span>
                      <span className="text-sm text-muted-foreground font-normal">
                        ({categoryMedia.length} {categoryMedia.length === 1 ? 'file' : 'files'})
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {categoryMedia.map((item) => (
                <div key={item.id} className="relative group border rounded-lg overflow-hidden">
                  {item.media_type === 'image' ? (
                    <img
                      src={item.signed_url || ''}
                      alt={item.file_name}
                      className="w-full h-40 object-cover"
                    />
                  ) : item.signed_thumb_url ? (
                    <div className="relative w-full h-40">
                      <img
                        src={item.signed_thumb_url}
                        alt={item.file_name}
                        className="w-full h-40 object-cover"
                      />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Video className="h-8 w-8 text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-40 bg-muted flex items-center justify-center">
                      <Video className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-2 space-y-1">
                    <p className="text-sm font-medium truncate">{item.file_name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag, idx) => (
                          <span key={idx} className="text-xs bg-secondary px-2 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(item.file_size)}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
