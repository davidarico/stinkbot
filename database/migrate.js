#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Database connection configuration
// Priority: DATABASE_URL > individual env vars > defaults
const config = process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
} : {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stinkbot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
};

class MigrationRunner {
    constructor() {
        this.client = new Client(config);
        this.migrationsDir = path.join(__dirname, 'migrations');
    }

    async connect() {
        try {
            await this.client.connect();
            console.log('Connected to database');
        } catch (error) {
            console.error('Failed to connect to database:', error.message);
            process.exit(1);
        }
    }

    async disconnect() {
        await this.client.end();
    }

    async ensureMigrationsTable() {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                version VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        try {
            await this.client.query(createTableQuery);
            console.log('Migrations table ready');
        } catch (error) {
            console.error('Failed to create migrations table:', error.message);
            process.exit(1);
        }
    }

    async getAppliedMigrations() {
        try {
            const result = await this.client.query('SELECT version FROM schema_migrations ORDER BY version');
            return result.rows.map(row => row.version);
        } catch (error) {
            console.error('Failed to get applied migrations:', error.message);
            return [];
        }
    }

    getMigrationFiles() {
        if (!fs.existsSync(this.migrationsDir)) {
            console.log('No migrations directory found');
            return [];
        }

        return fs.readdirSync(this.migrationsDir)
            .filter(file => file.endsWith('.sql') && !file.endsWith('.rollback.sql'))
            .sort();
    }

    async applyMigration(filename) {
        const filePath = path.join(this.migrationsDir, filename);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        console.log(`Applying migration: ${filename}`);
        
        try {
            await this.client.query('BEGIN');
            
            // Execute the entire file as one statement to avoid issues with
            // semicolons inside string literals
            await this.client.query(sql);
            
            // Record the migration as applied
            const version = filename.replace('.sql', '');
            await this.client.query(
                'INSERT INTO schema_migrations (version) VALUES ($1)',
                [version]
            );
            
            await this.client.query('COMMIT');
            console.log(`✓ Applied migration: ${filename}`);
        } catch (error) {
            await this.client.query('ROLLBACK');
            console.error(`✗ Failed to apply migration ${filename}:`, error.message);
            throw error;
        }
    }

    async rollbackMigration(filename) {
        const version = filename.replace('.sql', '');
        const rollbackFile = filename.replace('.sql', '.rollback.sql');
        const rollbackPath = path.join(this.migrationsDir, rollbackFile);
        
        if (!fs.existsSync(rollbackPath)) {
            console.error(`No rollback file found: ${rollbackFile}`);
            return false;
        }

        const sql = fs.readFileSync(rollbackPath, 'utf8');
        
        console.log(`Rolling back migration: ${filename}`);
        
        try {
            await this.client.query('BEGIN');
            
            // Split by semicolon and execute each statement
            const statements = sql.split(';').filter(stmt => stmt.trim());
            
            for (const statement of statements) {
                if (statement.trim()) {
                    await this.client.query(statement);
                }
            }
            
            // Remove the migration record
            await this.client.query(
                'DELETE FROM schema_migrations WHERE version = $1',
                [version]
            );
            
            await this.client.query('COMMIT');
            console.log(`✓ Rolled back migration: ${filename}`);
            return true;
        } catch (error) {
            await this.client.query('ROLLBACK');
            console.error(`✗ Failed to rollback migration ${filename}:`, error.message);
            throw error;
        }
    }

    async migrate() {
        await this.connect();
        await this.ensureMigrationsTable();
        
        const appliedMigrations = await this.getAppliedMigrations();
        const migrationFiles = this.getMigrationFiles();
        
        const pendingMigrations = migrationFiles.filter(
            file => !appliedMigrations.includes(file.replace('.sql', ''))
        );
        
        if (pendingMigrations.length === 0) {
            console.log('No pending migrations');
            return;
        }
        
        console.log(`Found ${pendingMigrations.length} pending migration(s)`);
        
        for (const migration of pendingMigrations) {
            await this.applyMigration(migration);
        }
        
        console.log('All migrations applied successfully');
    }

    async rollback(steps = 1) {
        await this.connect();
        await this.ensureMigrationsTable();
        
        const appliedMigrations = await this.getAppliedMigrations();
        
        if (appliedMigrations.length === 0) {
            console.log('No migrations to rollback');
            return;
        }
        
        const toRollback = appliedMigrations.slice(-steps).reverse();
        
        console.log(`Rolling back ${toRollback.length} migration(s)`);
        
        for (const version of toRollback) {
            const filename = `${version}.sql`;
            await this.rollbackMigration(filename);
        }
        
        console.log('Rollback completed');
    }

    async status() {
        await this.connect();
        await this.ensureMigrationsTable();
        
        const appliedMigrations = await this.getAppliedMigrations();
        const migrationFiles = this.getMigrationFiles();
        
        console.log('\nMigration Status:');
        console.log('=================');
        
        migrationFiles.forEach(file => {
            const version = file.replace('.sql', '');
            const status = appliedMigrations.includes(version) ? '✓ Applied' : '○ Pending';
            console.log(`${status} ${file}`);
        });
        
        console.log(`\nTotal: ${migrationFiles.length} migrations, ${appliedMigrations.length} applied`);
    }

    async create(name) {
        if (!name) {
            console.error('Migration name is required');
            process.exit(1);
        }
        
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
        const filename = `${timestamp}_${name.replace(/\s+/g, '_').toLowerCase()}`;
        
        const migrationPath = path.join(this.migrationsDir, `${filename}.sql`);
        const rollbackPath = path.join(this.migrationsDir, `${filename}.rollback.sql`);
        
        const migrationTemplate = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
`;

        const rollbackTemplate = `-- Rollback for: ${name}
-- Created: ${new Date().toISOString()}

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
`;

        fs.writeFileSync(migrationPath, migrationTemplate);
        fs.writeFileSync(rollbackPath, rollbackTemplate);
        
        console.log(`Created migration files:`);
        console.log(`  ${filename}.sql`);
        console.log(`  ${filename}.rollback.sql`);
    }
}

// CLI interface
async function main() {
    const runner = new MigrationRunner();
    const command = process.argv[2];
    
    try {
        switch (command) {
            case 'migrate':
            case 'up':
                await runner.migrate();
                break;
            case 'rollback':
            case 'down':
                const steps = parseInt(process.argv[3]) || 1;
                await runner.rollback(steps);
                break;
            case 'status':
                await runner.status();
                break;
            case 'create':
                const name = process.argv.slice(3).join(' ');
                await runner.create(name);
                break;
            default:
                console.log('Usage:');
                console.log('  node migrate.js migrate     - Apply pending migrations');
                console.log('  node migrate.js rollback [n] - Rollback n migrations (default: 1)');
                console.log('  node migrate.js status      - Show migration status');
                console.log('  node migrate.js create <name> - Create new migration');
                process.exit(1);
        }
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await runner.disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = MigrationRunner;
