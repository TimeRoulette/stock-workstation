/** 轻量 Lucide 按需封装，统一侧栏/底栏/操作图标尺寸 */
import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Menu,
  Moon,
  Newspaper,
  NotebookPen,
  Search,
  Settings,
  Sun,
  Upload,
  Wallet,
  X,
  Bell,
  BellOff,
  Save,
  Play,
  Square,
  RefreshCw,
  ClipboardList,
} from 'lucide-react'

const SIZE = 18
const STROKE = 1.75

function wrap(Comp: LucideIcon, label?: string) {
  return function LucideIconBtn(props: LucideProps & { label?: string }) {
    const { label: aria = label, className, ...rest } = props
    return (
      <Comp
        size={SIZE}
        strokeWidth={STROKE}
        className={`ui-icon ${className || ''}`.trim()}
        aria-hidden={aria ? undefined : true}
        aria-label={aria}
        {...rest}
      />
    )
  }
}

export const Icons = {
  watchlist: wrap(Eye),
  volume: wrap(Activity),
  screener: wrap(Search),
  portfolio: wrap(Wallet),
  live: wrap(ClipboardList),
  brief: wrap(Newspaper),
  journal: wrap(NotebookPen),
  settings: wrap(Settings),
  sun: wrap(Sun),
  moon: wrap(Moon),
  menu: wrap(Menu),
  close: wrap(X),
  chevronLeft: wrap(ChevronLeft),
  chevronRight: wrap(ChevronRight),
  download: wrap(Download),
  upload: wrap(Upload),
  bell: wrap(Bell),
  bellOff: wrap(BellOff),
  save: wrap(Save),
  play: wrap(Play),
  stop: wrap(Square),
  refresh: wrap(RefreshCw),
  book: wrap(BookOpen),
  chart: wrap(BarChart3),
}
