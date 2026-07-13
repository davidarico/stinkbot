import { ArchiveBrowser } from '@/components/archive-browser'

// Not linked from any nav - reachable only by direct URL.
export default function BaseballArchivesPage() {
  return <ArchiveBrowser apiBase="/api/archives/baseball" title="Baseball Server Archives" backHref="/archives" />
}
