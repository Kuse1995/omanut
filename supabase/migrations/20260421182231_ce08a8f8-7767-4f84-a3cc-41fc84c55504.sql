
-- Fix 1: Switch ANZ from hybrid to autonomous service_mode
-- (sales_mode=human_in_loop on companies still controls checkout escalation;
-- this just stops the wholesale handoff on every "buy" or "price" word)
UPDATE company_ai_overrides
SET service_mode = 'autonomous'
WHERE company_id = '74ec87e8-a075-45b7-af75-e7503d683818';

-- Fix 2: Expand Customer Care trigger keywords to catch order/delivery questions
UPDATE company_agent_modes
SET trigger_keywords = ARRAY[
  'issue', 'problem', 'wrong', 'broken', 'not working',
  'help', 'complaint', 'disappointed', 'frustrated', 'refund',
  -- New: order status / delivery / fulfillment
  'late', 'delivery', 'delivered', 'where is', 'where''s',
  'my order', 'tracking', 'shipped', 'shipping',
  'exchange', 'return', 'damaged', 'missing',
  'haven''t received', 'not received', 'still waiting'
]
WHERE company_id = '74ec87e8-a075-45b7-af75-e7503d683818'
  AND slug = 'support';

-- Fix 3: Sharpen Sales triggers — remove "order" (too generic, conflicts with "my order is late")
UPDATE company_agent_modes
SET trigger_keywords = ARRAY[
  'price', 'cost', 'buy', 'purchase', 'available',
  'recommend', 'show me', 'pay', 'payment', 'checkout',
  'how much', 'in stock', 'do you have', 'do you sell',
  'photo', 'picture', 'pic', 'video'
]
WHERE company_id = '74ec87e8-a075-45b7-af75-e7503d683818'
  AND slug = 'sales';
