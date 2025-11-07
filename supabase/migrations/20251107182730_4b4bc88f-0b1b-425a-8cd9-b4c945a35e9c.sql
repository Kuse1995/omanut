-- Create payment_products table
CREATE TABLE payment_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'ZMW',
  category TEXT,
  selar_link TEXT,
  duration_minutes INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE payment_products ENABLE ROW LEVEL SECURITY;

-- Policies for payment_products
CREATE POLICY "Admins can manage all products" ON payment_products
  FOR ALL USING (has_role(auth.uid(), 'admin'));
  
CREATE POLICY "Users can view their company products" ON payment_products
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage their company products" ON payment_products
  FOR ALL USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- Indexes for payment_products
CREATE INDEX idx_payment_products_company_id ON payment_products(company_id);
CREATE INDEX idx_payment_products_active ON payment_products(is_active) WHERE is_active = true;

-- Trigger for payment_products updated_at
CREATE TRIGGER update_payment_products_updated_at 
  BEFORE UPDATE ON payment_products 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create payment_transactions table
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  product_id UUID REFERENCES payment_products(id),
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'ZMW',
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  payment_reference TEXT,
  payment_link TEXT,
  moneyunify_transaction_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Policies for payment_transactions
CREATE POLICY "Admins can view all transactions" ON payment_transactions
  FOR SELECT USING (has_role(auth.uid(), 'admin'));
  
CREATE POLICY "Users can view their company transactions" ON payment_transactions
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "System can insert transactions" ON payment_transactions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update their company transactions" ON payment_transactions
  FOR UPDATE USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- Indexes for payment_transactions
CREATE INDEX idx_payment_transactions_company_id ON payment_transactions(company_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(payment_status);
CREATE INDEX idx_payment_transactions_conversation ON payment_transactions(conversation_id);
CREATE INDEX idx_payment_transactions_reference ON payment_transactions(payment_reference);

-- Trigger for payment_transactions updated_at
CREATE TRIGGER update_payment_transactions_updated_at 
  BEFORE UPDATE ON payment_transactions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();