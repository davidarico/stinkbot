UPDATE roles
SET default_charges = 3
WHERE LOWER(name) = 'serial killer' AND has_charges = TRUE;

UPDATE roles
SET name = 'Alpha'
WHERE name = 'Alpha Wolf';
