PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('wash_fold', 'dry_clean', 'iron_only')),
  weight_kg REAL NOT NULL CHECK (weight_kg >= 0.1),
  pickup_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending_pickup',
      'ready_for_pickup',
      'confirmed',
      'assigned',
      'picked_up',
      'processing',
      'completed',
      'cancelled'
    )
  ),
  -- Fulfilling outlet. Optional: orders created before P4 have no outlet and
  -- stay readable only by their customer.
  outlet_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created
ON orders(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_orders_outlet_created
ON orders(outlet_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_orders_customer_created
ON orders(customer_id, created_at, id);

CREATE TABLE IF NOT EXISTS pickups (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  driver_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('scheduled', 'assigned', 'picked_up', 'delivered', 'cancelled')
  ),
  collected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pickups_driver_created
ON pickups(driver_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_pickups_order
ON pickups(order_id);

CREATE TABLE IF NOT EXISTS cancellations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  request_status TEXT NOT NULL CHECK (
    request_status IN ('processing', 'completed', 'failed')
  ),
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
