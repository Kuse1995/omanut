import { useNavigate } from "react-router-dom";
import { ArrowLeft, ImageIcon, Sparkles } from "lucide-react";
import ClientLayout from "@/components/dashboard/ClientLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import CompanyMedia from "@/components/CompanyMedia";
import { ImageGenerationSettings } from "@/components/ImageGenerationSettings";
import { useCompany } from "@/context/CompanyContext";

const MediaStudio = () => {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();

  return (
    <ClientLayout>
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto pb-24 md:pb-8">
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
            className="mb-3 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Media & Images</h1>
          <p className="text-muted-foreground mt-1">
            Upload product photos and control how the AI generates branded images for your customers.
          </p>
        </div>

        {!selectedCompany ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a business to manage its media.
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="library" className="space-y-6">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="library" className="gap-2">
                <ImageIcon className="w-4 h-4" /> Library
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-2">
                <Sparkles className="w-4 h-4" /> AI Image Generation
              </TabsTrigger>
            </TabsList>

            <TabsContent value="library">
              <CompanyMedia companyId={selectedCompany.id} />
            </TabsContent>

            <TabsContent value="ai">
              <ImageGenerationSettings companyId={selectedCompany.id} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ClientLayout>
  );
};

export default MediaStudio;
