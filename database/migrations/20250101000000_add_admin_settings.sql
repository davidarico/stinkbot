-- Add admin settings table for password protection
CREATE TABLE admin_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Initial admin password must be set manually after deployment.
-- Run: INSERT INTO admin_settings (setting_key, setting_value) VALUES ('admin_password', '<your-password>');
-- Never commit a real password to version control.
