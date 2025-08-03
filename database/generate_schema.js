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

class SchemaGenerator {
    constructor() {
        this.client = new Client(config);
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

    async getTables() {
        const query = `
            SELECT 
                t.table_name,
                obj_description(c.oid, 'pg_class') as table_comment
            FROM information_schema.tables t
            LEFT JOIN pg_class c ON c.relname = t.table_name
            LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE t.table_schema = 'public' 
                AND t.table_type = 'BASE TABLE'
                AND t.table_name != 'schema_migrations'
            ORDER BY t.table_name;
        `;
        
        try {
            const result = await this.client.query(query);
            return result.rows;
        } catch (error) {
            console.error('Failed to get tables:', error.message);
            return [];
        }
    }

    async getTableColumns(tableName) {
        const query = `
            SELECT 
                c.column_name,
                c.data_type,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                c.is_nullable,
                c.column_default,
                CASE 
                    WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY'
                    WHEN fk.column_name IS NOT NULL THEN 'FOREIGN KEY'
                    WHEN uq.column_name IS NOT NULL THEN 'UNIQUE'
                    ELSE NULL
                END as constraint_type,
                fk.foreign_table_name,
                fk.foreign_column_name,
                fk.delete_rule,
                pk.is_part_of_composite_pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT 
                    ku.column_name,
                    CASE 
                        WHEN tc.constraint_type = 'PRIMARY KEY' AND 
                             (SELECT COUNT(*) FROM information_schema.key_column_usage 
                              WHERE constraint_name = tc.constraint_name) > 1 
                        THEN true 
                        ELSE false 
                    END as is_part_of_composite_pk
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                    ON tc.constraint_name = ku.constraint_name
                WHERE tc.table_name = $1 
                    AND tc.constraint_type = 'PRIMARY KEY'
            ) pk ON c.column_name = pk.column_name
            LEFT JOIN (
                SELECT 
                    ku.column_name,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name,
                    rc.delete_rule
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                    ON tc.constraint_name = ku.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                JOIN information_schema.referential_constraints rc
                    ON rc.constraint_name = tc.constraint_name
                WHERE tc.table_name = $1 
                    AND tc.constraint_type = 'FOREIGN KEY'
            ) fk ON c.column_name = fk.column_name
            LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                    ON tc.constraint_name = ku.constraint_name
                WHERE tc.table_name = $1 
                    AND tc.constraint_type = 'UNIQUE'
            ) uq ON c.column_name = uq.column_name
            WHERE c.table_name = $1
            ORDER BY c.ordinal_position;
        `;
        
        try {
            const result = await this.client.query(query, [tableName]);
            return result.rows;
        } catch (error) {
            console.error(`Failed to get columns for table ${tableName}:`, error.message);
            return [];
        }
    }

    async getTableConstraints(tableName) {
        const query = `
            SELECT DISTINCT
                tc.constraint_name,
                tc.constraint_type,
                STRING_AGG(DISTINCT ku.column_name, ', ' ORDER BY ku.column_name) as columns
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.key_column_usage ku
                ON tc.constraint_name = ku.constraint_name
            WHERE tc.table_name = $1
                AND tc.constraint_type IN ('UNIQUE', 'CHECK')
                AND tc.constraint_name NOT LIKE '%_pkey'
            GROUP BY tc.constraint_name, tc.constraint_type
            ORDER BY tc.constraint_type, tc.constraint_name;
        `;
        
        try {
            const result = await this.client.query(query, [tableName]);
            return result.rows;
        } catch (error) {
            console.error(`Failed to get constraints for table ${tableName}:`, error.message);
            return [];
        }
    }

    formatDataType(column) {
        const { data_type, character_maximum_length, numeric_precision, numeric_scale } = column;
        
        switch (data_type.toLowerCase()) {
            case 'character varying':
                return `VARCHAR(${character_maximum_length})`;
            case 'character':
                return `CHAR(${character_maximum_length})`;
            case 'numeric':
                if (numeric_precision && numeric_scale) {
                    return `NUMERIC(${numeric_precision},${numeric_scale})`;
                } else if (numeric_precision) {
                    return `NUMERIC(${numeric_precision})`;
                }
                return 'NUMERIC';
            case 'timestamp with time zone':
                return 'TIMESTAMPTZ';
            case 'timestamp without time zone':
                return 'TIMESTAMP';
            default:
                return data_type.toUpperCase();
        }
    }

    async generateSchema() {
        const tables = await this.getTables();
        let schema = `-- Werewolf Discord Bot Database Schema
-- Generated automatically on ${new Date().toISOString()}
-- This file shows the current database structure with table comments
-- Run this after migrations to get the latest schema

`;

        for (const table of tables) {
            const { table_name, table_comment } = table;
            
            // Add table comment if it exists
            if (table_comment) {
                schema += `-- ${table_comment}\n`;
            }
            
            schema += `CREATE TABLE ${table_name} (\n`;
            
            const columns = await this.getTableColumns(table_name);
            const columnDefinitions = [];
            
            for (const column of columns) {
                let columnDef = `    ${column.column_name} ${this.formatDataType(column)}`;
                
                // Add NOT NULL constraint
                if (column.is_nullable === 'NO') {
                    columnDef += ' NOT NULL';
                }
                
                // Add default value
                if (column.column_default) {
                    let defaultValue = column.column_default;
                    // Clean up common default value formats
                    if (defaultValue === 'CURRENT_TIMESTAMP') {
                        columnDef += ' DEFAULT CURRENT_TIMESTAMP';
                    } else if (defaultValue.includes('nextval')) {
                        // This is a serial column, we'll handle it differently
                        columnDef = `    ${column.column_name} SERIAL`;
                        if (column.constraint_type === 'PRIMARY KEY') {
                            columnDef += ' PRIMARY KEY';
                        }
                    } else {
                        // Clean up PostgreSQL-style defaults
                        defaultValue = defaultValue.replace(/::[\w\s]+/g, '').replace(/'/g, "'");
                        if (defaultValue.includes('::')) {
                            defaultValue = defaultValue.split('::')[0];
                        }
                        if (defaultValue === 'false') {
                            columnDef += ' DEFAULT FALSE';
                        } else if (defaultValue === 'true') {
                            columnDef += ' DEFAULT TRUE';
                        } else if (!isNaN(defaultValue)) {
                            columnDef += ` DEFAULT ${defaultValue}`;
                        } else {
                            columnDef += ` DEFAULT ${defaultValue}`;
                        }
                    }
                }
                
                // Add constraint info (except for serial primary keys which are already handled)
                if (column.constraint_type && !columnDef.includes('SERIAL PRIMARY KEY')) {
                    if (column.constraint_type === 'PRIMARY KEY' && !column.is_part_of_composite_pk) {
                        columnDef += ' PRIMARY KEY';
                    } else if (column.constraint_type === 'FOREIGN KEY') {
                        columnDef += ` REFERENCES ${column.foreign_table_name}(${column.foreign_column_name})`;
                        if (column.delete_rule === 'CASCADE') {
                            columnDef += ' ON DELETE CASCADE';
                        }
                    }
                }
                
                columnDefinitions.push(columnDef);
            }
            
            schema += columnDefinitions.join(',\n');
            
            // Add table-level constraints
            const constraints = await this.getTableConstraints(table_name);
            const addedConstraints = new Set();
            
            // Check for composite primary keys
            const compositePkColumns = columns
                .filter(col => col.constraint_type === 'PRIMARY KEY' && col.is_part_of_composite_pk)
                .map(col => col.column_name);
            
            if (compositePkColumns.length > 0) {
                schema += `,\n    PRIMARY KEY (${compositePkColumns.join(', ')})`;
            }
            
            for (const constraint of constraints) {
                if (constraint.constraint_type === 'UNIQUE' && !addedConstraints.has(constraint.columns)) {
                    schema += `,\n    UNIQUE(${constraint.columns})`;
                    addedConstraints.add(constraint.columns);
                }
            }
            
            schema += '\n);\n\n';
        }

        return schema;
    }

    async run() {
        await this.connect();
        
        try {
            console.log('Generating database schema...');
            const schema = await this.generateSchema();
            
            const outputFile = path.join(__dirname, 'current_schema.sql');
            fs.writeFileSync(outputFile, schema, 'utf8');
            
            console.log(`Schema generated successfully: ${outputFile}`);
            console.log('This file shows your current database structure with table comments.');
            
        } catch (error) {
            console.error('Error generating schema:', error.message);
            process.exit(1);
        } finally {
            await this.disconnect();
        }
    }
}

// Run the schema generator
if (require.main === module) {
    const generator = new SchemaGenerator();
    generator.run();
}

module.exports = SchemaGenerator;
