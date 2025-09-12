'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

interface KanbanColumnProps {
  id: string
  title: string
  color: string
  tasks: Task[]
  onEditTask: (task: Task) => void
}

export function KanbanColumn({ id, title, color, tasks, onEditTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  })

  return (
    <Card className={`bg-gray-800 border-gray-700 min-h-[400px] ${isOver ? 'ring-2 ring-blue-500' : ''} py-0`}>
      <CardHeader className={`${color} text-white rounded-t-lg py-2`}>
        <CardTitle className="text-lg font-semibold">
          {title}
          <span className="ml-2 text-sm opacity-75">({tasks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div
          ref={setNodeRef}
          className="space-y-3 min-h-[300px]"
        >
          <SortableContext items={tasks.map(t => t.id.toString())} strategy={verticalListSortingStrategy}>
            {tasks.map(task => (
              <KanbanTask
                key={task.id}
                task={task}
                onEdit={() => onEditTask(task)}
              />
            ))}
          </SortableContext>
          
          {tasks.length === 0 && (
            <div className="text-gray-500 text-center py-8 text-sm">
              No tasks in this column
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
