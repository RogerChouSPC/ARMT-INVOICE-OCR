import { motion } from 'framer-motion'
import { Sparkles, LogOut } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb'

type Tab = 'ocr' | 'customer-master'

interface HeaderProps {
  rowCount: number
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  user: { name: string; email: string } | null
  onLogout: () => void
}

const TAB_LABELS: Record<Tab, string> = {
  'ocr': 'Invoice Extract',
  'customer-master': 'Customer Master',
}

export default function Header({ rowCount, activeTab, onTabChange, user, onLogout }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      {/* Main nav row */}
      <div className="w-full px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: 5, scale: 1.1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
              className="h-9 w-9 rounded-3xl bg-primary flex items-center justify-center"
            >
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </motion.div>
            <span className="font-bold text-base tracking-tight">SPC OCR</span>
          </div>

          <nav className="flex items-center gap-1">
            {(['ocr', 'customer-master'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={`px-4 py-1.5 rounded-3xl text-sm font-medium transition-all duration-150 ${
                  activeTab === tab
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'ocr' && rowCount > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-xs bg-muted text-muted-foreground px-3 py-1 rounded-3xl font-medium"
            >
              {rowCount} {rowCount === 1 ? 'row' : 'rows'} extracted
            </motion.span>
          )}

          {/* User info + logout */}
          {user && (
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-medium text-foreground leading-tight">{user.name}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">{user.email}</p>
              </div>
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <button
                onClick={onLogout}
                title="Sign out"
                className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb row */}
      <div className="w-full px-6 pb-2.5">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="#"
                onClick={(e) => { e.preventDefault(); onTabChange('ocr') }}
              >
                SPC OCR
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{TAB_LABELS[activeTab]}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
