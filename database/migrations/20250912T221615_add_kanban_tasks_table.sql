-- Migration: add_kanban_tasks_table
-- Created: 2025-09-12T22:16:15.726Z

-- Table to store kanban tasks for development tracking
CREATE TABLE kanban_tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Add comment to the table
COMMENT ON TABLE kanban_tasks IS 'Stores development tasks for the kanban board';
COMMENT ON COLUMN kanban_tasks.status IS 'Task status: todo, in_progress, blocked, or done';
COMMENT ON COLUMN kanban_tasks.position IS 'Position within the status column for drag and drop ordering';
