import { handleArchiveNavigation } from '@/lib/archive-search'

export async function GET() {
  return handleArchiveNavigation(false)
}
