import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import LiveDemo from "./pages/LiveDemo";
import Conversations from "./pages/Conversations";
import Reservations from "./pages/Reservations";
import Settings from "./pages/Settings";
import Billing from "./pages/Billing";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminVerify from "./pages/admin/AdminVerify";
import RequestAccess from "./pages/admin/RequestAccess";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Companies from "./pages/admin/Companies";
import NewCompany from "./pages/admin/NewCompany";
import EditCompany from "./pages/admin/EditCompany";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin/login" element={<RequestAccess />} />
          <Route path="/admin/request-access" element={<RequestAccess />} />
          <Route path="/admin/verify" element={<AdminVerify />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/companies" element={<Companies />} />
          <Route path="/admin/companies/new" element={<NewCompany />} />
          <Route path="/admin/company/:id" element={<EditCompany />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/live-demo" element={<LiveDemo />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
