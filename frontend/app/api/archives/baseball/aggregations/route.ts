import { handleArchiveAggregations } from '@/lib/archive-search'

export async function GET() {
  return handleArchiveAggregations(true)
}
