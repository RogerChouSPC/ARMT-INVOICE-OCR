type Tab = 'ocr' | 'customer-master'

interface HeaderProps {
  rowCount: number
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function Header({ rowCount, activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border" style={{ background: 'rgba(12,11,9,0.92)', backdropFilter: 'blur(16px)' }}>
      <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, #C9A84C 25%, #C9A84C 75%, transparent)', opacity: 0.45 }} />
      <div className="max-w-screen-2xl mx-auto px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-10">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display font-medium text-cream" style={{ fontSize: '1.1rem', letterSpacing: '0.12em' }}>SPC</span>
            <span className="font-mono text-[9px] text-gold tracking-widest uppercase opacity-80">Invoice OCR</span>
          </div>
          <nav className="flex items-center">
            {([['ocr', 'Extract'], ['customer-master', 'Customer Master']] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={`px-4 py-1 text-[11px] font-mono tracking-widest uppercase transition-all duration-150 border-b-2 ${
                  activeTab === tab
                    ? 'text-gold border-gold'
                    : 'text-faint border-transparent hover:text-muted hover:border-border'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        {activeTab === 'ocr' && rowCount > 0 && (
          <span className="font-mono text-[10px] tracking-widest text-gold uppercase animate-fade-in">
            {rowCount}&thinsp;rows
          </span>
        )}
      </div>
    </header>
  )
}
