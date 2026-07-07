import { NextRequest } from 'next/server'
import { handleArchiveSearch } from '@/lib/archive-search'

export async function GET(request: NextRequest) {
  return handleArchiveSearch(request, true)
}
