'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Edit2 } from 'lucide-react'

interface Task {
  id: number
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'blocked' | 'done'
  position: number
  created_at: string
  updated_at: string
}

interface KanbanTaskProps {
  task: Task
  isDragging?: boolean
  onEdit: () => void
}

export function KanbanTask({ task, isDragging = false, onEdit }: KanbanTaskProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id.toString() })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const opacity = isDragging || isSortableDragging ? 0.5 : 1

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`bg-gray-700 border-gray-600 cursor-grab active:cursor-grabbing hover:bg-gray-650 transition-colors ${opacity < 1 ? 'opacity-50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-white text-sm leading-tight">
              {task.title}
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-600"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
          
          {task.description && (
            <p className="text-gray-300 text-xs leading-relaxed">
              {task.description}
            </p>
          )}
          
          <div className="text-xs text-gray-400">
            Created {new Date(task.created_at).toLocaleDateString()}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
