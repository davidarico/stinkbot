'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Plus, ArrowLeft, Edit2, Save, X } from 'lucide-react'
import { KanbanColumn } from '@/components/kanban-column'
import { KanbanTask } from '@/components/kanban-task'

interface Task {
  id: number
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'blocked' | 'done'
  position: number
  created_at: string
  updated_at: string
}

const COLUMNS = [
  { id: 'todo', title: 'Todo', color: 'bg-gray-600' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-blue-600' },
  { id: 'blocked', title: 'Blocked', color: 'bg-red-600' },
  { id: 'done', title: 'Done', color: 'bg-green-600' }
] as const

export default function KanbanPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '' })
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '' })
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const router = useRouter()

  useEffect(() => {
    checkAuthentication()
  }, [])

  const checkAuthentication = async () => {
    try {
      const response = await fetch('/api/admin/verify')
      const data = await response.json()
      setIsAuthenticated(data.authenticated)
      if (data.authenticated) {
        fetchTasks()
      }
    } catch (error) {
      console.error('Error checking authentication:', error)
      setIsAuthenticated(false)
    }
  }

  const fetchTasks = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/kanban')
      const data = await response.json()
      
      if (data.success) {
        setTasks(data.tasks)
      } else {
        setError('Failed to fetch tasks')
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
      setError('Failed to fetch tasks')
    } finally {
      setIsLoading(false)
    }
  }

  const createTask = async () => {
    if (!newTask.title.trim()) return

    try {
      const response = await fetch('/api/admin/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTask.title.trim(),
          description: newTask.description.trim() || null
        })
      })

      const data = await response.json()
      
      if (data.success) {
        setTasks(prev => [...prev, data.task])
        setNewTask({ title: '', description: '' })
        setIsCreating(false)
      } else {
        setError(data.error || 'Failed to create task')
      }
    } catch (error) {
      console.error('Error creating task:', error)
      setError('Failed to create task')
    }
  }

  const updateTask = async (taskId: number, updates: Partial<Task>) => {
    try {
      const response = await fetch(`/api/admin/kanban/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      const data = await response.json()
      
      if (data.success) {
        setTasks(prev => prev.map(task => 
          task.id === taskId ? { ...task, ...data.task } : task
        ))
        setEditingTask(null)
      } else {
        setError(data.error || 'Failed to update task')
      }
    } catch (error) {
      console.error('Error updating task:', error)
      setError('Failed to update task')
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id.toString() === event.active.id)
    setActiveTask(task || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const activeId = active.id.toString()
    const overId = over.id.toString()
    
    const activeTask = tasks.find(t => t.id.toString() === activeId)
    if (!activeTask) return

    // If dropping on a column
    if (COLUMNS.some(col => col.id === overId)) {
      const newStatus = overId as Task['status']
      
      if (activeTask.status !== newStatus) {
        // Move to different column
        const tasksInNewColumn = tasks.filter(t => t.status === newStatus)
        const newPosition = tasksInNewColumn.length

        await updateTask(activeTask.id, { 
          status: newStatus, 
          position: newPosition 
        })
      }
    } else {
      // If dropping on another task
      const overTask = tasks.find(t => t.id.toString() === overId)
      if (!overTask || activeTask.id === overTask.id) return

      if (activeTask.status === overTask.status) {
        // Reorder within same column
        const columnTasks = tasks.filter(t => t.status === activeTask.status)
        const oldIndex = columnTasks.findIndex(t => t.id === activeTask.id)
        const newIndex = columnTasks.findIndex(t => t.id === overTask.id)

        const reorderedTasks = arrayMove(columnTasks, oldIndex, newIndex)
        
        // Update positions
        for (let i = 0; i < reorderedTasks.length; i++) {
          if (reorderedTasks[i].id !== activeTask.id) {
            await updateTask(reorderedTasks[i].id, { position: i })
          }
        }
        
        await updateTask(activeTask.id, { position: newIndex })
      } else {
        // Move to different column
        const tasksInNewColumn = tasks.filter(t => t.status === overTask.status)
        const newPosition = tasksInNewColumn.length

        await updateTask(activeTask.id, { 
          status: overTask.status, 
          position: newPosition 
        })
      }
    }
  }

  const startEditing = (task: Task) => {
    setEditingTask(task)
    setEditForm({ title: task.title, description: task.description || '' })
  }

  const saveEdit = () => {
    if (!editingTask || !editForm.title.trim()) return
    
    updateTask(editingTask.id, {
      title: editForm.title.trim(),
      description: editForm.description.trim() || null
    })
  }

  const cancelEdit = () => {
    setEditingTask(null)
    setEditForm({ title: '', description: '' })
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    )
  }

  if (!isAuthenticated) {
    router.push('/admin')
    return null
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button 
              onClick={() => router.push('/admin')} 
              variant="outline" 
              size="sm"
              className="bg-gray-600 text-white hover:bg-gray-700"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-white">Development Kanban</h1>
              <p className="text-gray-300 mt-2">Track development tasks and project progress</p>
            </div>
          </div>
          
          <Dialog open={isCreating} onOpenChange={setIsCreating}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Add Task
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-800 border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-white">Create New Task</DialogTitle>
                <DialogDescription className="text-gray-300">
                  Add a new task to the kanban board
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="title" className="text-white">Title</Label>
                  <Input
                    id="title"
                    value={newTask.title}
                    onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter task title"
                    className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                  />
                </div>
                <div>
                  <Label htmlFor="description" className="text-white">Description (optional)</Label>
                  <Textarea
                    id="description"
                    value={newTask.description}
                    onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter task description"
                    className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setIsCreating(false)}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={createTask}
                  disabled={!newTask.title.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Create Task
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {COLUMNS.map(column => {
              const columnTasks = tasks
                .filter(task => task.status === column.id)
                .sort((a, b) => a.position - b.position)

              return (
                <KanbanColumn
                  key={column.id}
                  id={column.id}
                  title={column.title}
                  color={column.color}
                  tasks={columnTasks}
                  onEditTask={startEditing}
                />
              )
            })}
          </div>

          <DragOverlay>
            {activeTask ? (
              <KanbanTask
                task={activeTask}
                isDragging={true}
                onEdit={() => {}}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Edit Task Dialog */}
        <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
          <DialogContent className="bg-gray-800 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">Edit Task</DialogTitle>
              <DialogDescription className="text-gray-300">
                Update task details
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-title" className="text-white">Title</Label>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter task title"
                  className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                />
              </div>
              <div>
                <Label htmlFor="edit-description" className="text-white">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editForm.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter task description"
                  className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={cancelEdit}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </Button>
              <Button 
                onClick={saveEdit}
                disabled={!editForm.title.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
