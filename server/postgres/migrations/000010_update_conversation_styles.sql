-- Migration to update conversation styling fields

ALTER TABLE conversations
DROP COLUMN IF EXISTS socialbtn_type,
DROP COLUMN IF EXISTS help_bgcolor,
DROP COLUMN IF EXISTS help_color;

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS font_color VARCHAR(20),
ADD COLUMN IF NOT EXISTS font_title VARCHAR(256),
ADD COLUMN IF NOT EXISTS font_serif VARCHAR(256),
ADD COLUMN IF NOT EXISTS font_sans VARCHAR(256); 
