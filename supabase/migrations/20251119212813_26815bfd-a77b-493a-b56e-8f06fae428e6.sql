-- Add active_agent column to conversations table
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS active_agent TEXT DEFAULT 'sales';

COMMENT ON COLUMN conversations.active_agent IS 'Current agent handling the conversation: support, sales, or boss';

-- Add agent_routing_enabled to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS agent_routing_enabled BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN companies.agent_routing_enabled IS 'Enable/disable multi-agent routing per company';

-- Add handed_off_by column to boss_conversations table
ALTER TABLE boss_conversations
ADD COLUMN IF NOT EXISTS handed_off_by TEXT;

COMMENT ON COLUMN boss_conversations.handed_off_by IS 'Which agent or system triggered the handoff: support_agent, sales_agent, supervisor_router, system';

-- Create agent_performance table for analytics
CREATE TABLE IF NOT EXISTS agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  routed_at TIMESTAMPTZ DEFAULT NOW(),
  routing_confidence FLOAT,
  handoff_occurred BOOLEAN DEFAULT FALSE,
  handoff_reason TEXT,
  conversation_resolved BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE agent_performance IS 'Analytics tracking for multi-agent system performance';

-- Create index for performance queries
CREATE INDEX IF NOT EXISTS idx_agent_performance_company_id ON agent_performance(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_performance_agent_type ON agent_performance(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_performance_routed_at ON agent_performance(routed_at);

-- Enable RLS on agent_performance table
ALTER TABLE agent_performance ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for agent_performance (admin access only)
CREATE POLICY "Admin users can view agent performance data"
  ON agent_performance
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );