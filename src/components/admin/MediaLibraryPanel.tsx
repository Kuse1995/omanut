 import { useCompany } from '@/context/CompanyContext';
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
 import CompanyMedia from '@/components/CompanyMedia';
 import { ImageIcon } from 'lucide-react';
 
 export const MediaLibraryPanel = () => {
   const { selectedCompany } = useCompany();
 
   if (!selectedCompany) {
     return (
       <div className="flex flex-col items-center justify-center h-full py-12 text-center">
         <ImageIcon className="w-12 h-12 text-muted-foreground mb-4" />
         <p className="text-muted-foreground">
           Select a company to manage media library
         </p>
       </div>
     );
   }
 
   return (
     <div className="p-6 space-y-6">
       <Card>
         <CardHeader>
           <CardTitle className="flex items-center gap-2">
             <ImageIcon className="w-5 h-5" />
             Media Library
           </CardTitle>
           <CardDescription>
             Upload and manage images and videos that AI can send to customers during conversations
           </CardDescription>
         </CardHeader>
         <CardContent>
           <CompanyMedia companyId={selectedCompany.id} />
         </CardContent>
       </Card>
     </div>
   );
 };