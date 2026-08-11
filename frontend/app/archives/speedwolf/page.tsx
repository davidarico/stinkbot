import { ArchiveBrowser } from '@/components/archive-browser'

export default function SpeedwolfArchivesPage() {
  return <ArchiveBrowser apiBase="/api/archives/speedwolf" title="Speedwolf Archives" backHref="/" />
}
