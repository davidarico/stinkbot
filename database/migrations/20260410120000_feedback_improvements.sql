-- Feedback-driven data fixes (see FEEDBACK.md analyses #58, #74)
-- #74: Serial Killer default charges 3 -> 4
UPDATE roles
SET default_charges = 4
WHERE LOWER(name) = 'serial killer' AND has_charges = TRUE;

-- #58: Display name Alpha -> Alpha Wolf (role row label; id unchanged)
UPDATE roles
SET name = 'Alpha Wolf'
WHERE name = 'Alpha';
