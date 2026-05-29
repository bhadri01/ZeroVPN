-- Visual theme preference. Orthogonal to the existing light/dark mode
-- toggle (which lives in localStorage only): this column picks the
-- VISUAL LANGUAGE — Swiss/Brutalist/Terminal/Editorial/Soft — and each
-- variant ships its own light + dark color tokens, font stack, radius,
-- and spacing scale. Default 'swiss' preserves the current look for
-- everyone on this migration.
ALTER TABLE user_preferences
    ADD COLUMN theme TEXT NOT NULL DEFAULT 'swiss'
        CHECK (theme IN ('swiss', 'brutalist', 'terminal', 'editorial', 'soft'));
