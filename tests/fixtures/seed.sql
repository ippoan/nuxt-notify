-- Integration test seed data for nuxt-notify
-- Runs AFTER migrations

SET search_path TO alc_api;

-- Test tenant
INSERT INTO tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Tenant', 'test-tenant');

-- Test user (admin)
INSERT INTO users (id, tenant_id, google_sub, email, name, role) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'google-sub-test', 'test@example.com', 'Test Admin', 'admin');

-- set_current_tenant for seed inserts (RLS requires this)
SELECT set_current_tenant('11111111-1111-1111-1111-111111111111');

-- Seed notify recipients
INSERT INTO notify_recipients (id, tenant_id, name, provider, line_user_id, phone_number) VALUES
  ('aaaaaaaa-0001-0001-0001-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'Seed LINE User', 'line', 'U_seed_line_001', '090-1111-1111');

INSERT INTO notify_recipients (id, tenant_id, name, provider, lineworks_user_id, phone_number) VALUES
  ('aaaaaaaa-0002-0002-0002-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'Seed LW User', 'lineworks', 'lw_seed_001@example.com', '090-2222-2222');
