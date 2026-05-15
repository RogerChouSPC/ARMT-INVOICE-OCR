type Tab = 'ocr' | 'customer-master'

interface HeaderProps {
  rowCount: number
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function Header({ rowCount, activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
      <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-google-blue rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 4h6v6h6v10H6V4z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-medium text-gray-800 leading-tight">SPC OCR Invoice</h1>
              <p className="text-xs text-gray-500 leading-tight">Thai Invoice Extractor · Gemini AI</p>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            <button
              onClick={() => onTabChange('ocr')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === 'ocr'
                  ? 'bg-google-blue text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Invoice OCR
            </button>
            <button
              onClick={() => onTabChange('customer-master')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === 'customer-master'
                  ? 'bg-google-blue text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Customer Master
            </button>
          </nav>
        </div>

        {activeTab === 'ocr' && rowCount > 0 && (
          <span className="text-xs bg-google-blue-light text-google-blue px-3 py-1 rounded-full font-medium">
            {rowCount} {rowCount === 1 ? 'row' : 'rows'} extracted
          </span>
        )}
      </div>
    </header>
  )
}
