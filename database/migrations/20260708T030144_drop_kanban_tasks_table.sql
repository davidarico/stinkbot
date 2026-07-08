-- Migration: drop_kanban_tasks_table
-- Created: 2026-07-08T03:01:44.769Z

-- The kanban board (frontend/app/admin/kanban) was removed, so this table is no longer used.
DROP TABLE IF EXISTS kanban_tasks;
