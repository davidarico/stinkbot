import { ArchiveBrowser } from '@/components/archive-browser'

export default function ArchivesPage() {
  return <ArchiveBrowser apiBase="/api/archives" title="Message Archives" backHref="/" />
}
