PRAGMA foreign_keys = ON;

CREATE TABLE homes (
  id TEXT PRIMARY KEY CONSTRAINT homes_id_required CHECK (length(id) > 0),
  name TEXT NOT NULL CONSTRAINT homes_name_required CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE members (
  id TEXT PRIMARY KEY CONSTRAINT members_id_required CHECK (length(id) > 0),
  home_id TEXT NOT NULL,
  name TEXT NOT NULL CONSTRAINT members_name_required CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CONSTRAINT members_position_nonnegative CHECK (position >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY CONSTRAINT bills_id_required CHECK (length(id) > 0),
  home_id TEXT NOT NULL,
  title TEXT NOT NULL CONSTRAINT bills_title_required CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_total_positive CHECK (total_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY CONSTRAINT shares_id_required CHECK (length(id) > 0),
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CONSTRAINT shares_amount_nonnegative CHECK (amount_cents >= 0),
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id)
);
