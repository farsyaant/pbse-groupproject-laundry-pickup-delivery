INSERT OR IGNORE INTO orders (
  id,
  customer_id,
  service_type,
  weight_kg,
  pickup_address,
  status,
  created_at,
  updated_at
) VALUES (
  'ord_seed001',
  'cus_seed001',
  'wash_fold',
  5.5,
  'Jl. Contoh No. 1, Jakarta',
  'pending_pickup',
  '2026-01-01T10:00:00.000Z',
  '2026-01-01T10:00:00.000Z'
);