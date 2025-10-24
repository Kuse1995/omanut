-- Create agent_config table for dynamic configuration
CREATE TABLE agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_name TEXT NOT NULL DEFAULT 'Demo Lodge',
  restaurant_hours TEXT NOT NULL DEFAULT 'Mon-Sun: 10:00 - 23:00',
  menu TEXT NOT NULL DEFAULT 'Grilled fish, T-bone, braai, chicken, chips, nshima, salads.',
  instructions TEXT NOT NULL DEFAULT 'Be polite, confirm bookings, use Kwacha.',
  currency_prefix TEXT NOT NULL DEFAULT 'K',
  branches TEXT NOT NULL DEFAULT 'Main',
  seating_areas TEXT NOT NULL DEFAULT 'poolside,outdoor,inside,VIP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to agent_config" ON agent_config FOR ALL USING (true) WITH CHECK (true);

-- Insert default row for Zambian lodge
INSERT INTO agent_config (
  restaurant_name,
  restaurant_hours,
  menu,
  instructions,
  currency_prefix,
  branches,
  seating_areas
) VALUES (
  'Streamside Lodge',
  'Mon-Sun: 10:00 - 23:00',
  'Grilled fish (K180), T-bone steak (K220), chicken braai (K150), nshima sides, salads.',
  'Always collect phone number first. Use Kwacha. Offer poolside and VIP if available.',
  'K',
  'Main',
  'poolside,outdoor,inside,VIP'
);

-- Create conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to conversations" ON conversations FOR ALL USING (true) WITH CHECK (true);

-- Create messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to messages" ON messages FOR ALL USING (true) WITH CHECK (true);

-- Create reservations table
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  date DATE NOT NULL,
  time TIME NOT NULL,
  guests INTEGER NOT NULL,
  occasion TEXT,
  area_preference TEXT,
  branch TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to reservations" ON reservations FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for conversations and reservations
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;