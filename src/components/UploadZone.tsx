import { useRef, useState, useCallback } from 'react'

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  disabled: boolean
}

export default function UploadZone({ onFiles, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return
      const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf')
      if (pdfs.length) onFiles(pdfs)
    },
    [onFiles, disabled]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  return (
    <div
      className={`
        card p-12 flex flex-col items-center justify-center gap-5 cursor-pointer
        border-2 border-dashed transition-all duration-200 select-none
        ${dragging ? 'border-google-blue bg-google-blue-light scale-[1.01]' : 'border-gray-200 hover:border-google-blue hover:bg-gray-50'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />

      {/* Cloud upload icon */}
      <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${dragging ? 'bg-google-blue' : 'bg-google-blue-light'}`}>
        <svg viewBox="0 0 24 24" className={`w-8 h-8 transition-colors ${dragging ? 'fill-white' : 'fill-google-blue'}`}>
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
        </svg>
      </div>

      <div className="text-center">
        <p className="text-lg font-medium text-gray-700">
          {dragging ? 'Drop your PDFs here' : 'Upload Invoice PDFs'}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Drag & drop or <span className="text-google-blue font-medium">browse files</span>
        </p>
        <p className="text-xs text-gray-400 mt-2">Supports Thai language invoices · Multiple files allowed</p>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-gray-400"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          Google Vision OCR
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-gray-400"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
          22-column Excel output
        </span>
      </div>
    </div>
  )
}
