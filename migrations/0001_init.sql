-- Recipes. Structured ingredient/step/tag data is stored as JSON text.
CREATE TABLE recipes (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  servings        REAL,
  yield_text      TEXT,
  prep_minutes    INTEGER,
  cook_minutes    INTEGER,
  total_minutes   INTEGER,
  source_url      TEXT,
  source_name     TEXT,
  image_key       TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  steps_json      TEXT NOT NULL DEFAULT '[]',
  tags_json       TEXT NOT NULL DEFAULT '[]',
  nutrition_json  TEXT,
  notes           TEXT,
  rating          INTEGER,
  favorite        INTEGER NOT NULL DEFAULT 0,
  cook_count      INTEGER NOT NULL DEFAULT 0,
  last_cooked     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_recipes_title ON recipes (title COLLATE NOCASE);
CREATE INDEX idx_recipes_updated ON recipes (updated_at);

-- Meal plan: one row per planned meal. Either a recipe or a free-text note ("Leftovers").
CREATE TABLE meal_plan (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,            -- YYYY-MM-DD
  meal       TEXT NOT NULL,            -- breakfast | lunch | dinner | snack
  recipe_id  TEXT REFERENCES recipes (id) ON DELETE CASCADE,
  note       TEXT,
  servings   REAL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_plan_date ON meal_plan (date);

-- Shopping list
CREATE TABLE shopping_items (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  amount     TEXT,                     -- display amount, e.g. "1 cup + 2 tbsp"
  aisle      TEXT NOT NULL DEFAULT 'Other',
  checked    INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'manual', -- manual | plan
  recipes    TEXT,                     -- comma-separated recipe titles it came from
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
