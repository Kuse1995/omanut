-- Add WhatsApp support columns to companies table
ALTER TABLE companies
ADD COLUMN whatsapp_number TEXT,
ADD COLUMN whatsapp_voice_enabled BOOLEAN DEFAULT false;