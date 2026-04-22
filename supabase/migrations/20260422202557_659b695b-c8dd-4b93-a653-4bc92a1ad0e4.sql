-- Deactivate GreenGrid Energy's incorrect bms_connections row.
-- The row was auto-created with the default multi-tenant bridge URL pointing
-- at an unrelated BMS (Omanut/ANZ shared bridge), causing a cross-tenant data leak.
-- GreenGrid has no real BMS yet — set is_active=false so loadBmsConnection returns null
-- and bms-agent returns the empty/no_connection state instead of leaking another tenant's catalog.
UPDATE public.bms_connections
SET is_active = false,
    updated_at = now()
WHERE company_id = '877876bc-7de8-4003-bd64-4bb4c274e6b9';