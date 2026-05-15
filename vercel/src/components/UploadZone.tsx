import { useRef, useState, useCallback, useEffect } from 'react'

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  disabled: boolean
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>(resolve => reader.readEntries(resolve))
    if (batch.length === 0) break
    entries.push(...batch)
  }
  return entries
}

async function collectPdfsFromItems(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = []
  const processEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      await new Promise<void>(resolve => {
        ;(entry as FileSystemFileEntry).file(f => {
          if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) files.push(f)
          resolve()
        })
      })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const entries = await readAllEntries(reader)
      await Promise.all(entries.map(processEntry))
    }
  }
  const entries = Array.from(items)
    .map(item => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null)
  await Promise.all(entries.map(processEntry))
  return files
}

export default function UploadZone({ onFiles, disabled }: UploadZoneProps) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute('webkitdirectory', '')
      folderRef.current.setAttribute('directory', '')
    }
  }, [])

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return
      const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      if (pdfs.length) onFiles(pdfs)
    },
    [onFiles, disabled]
  )

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (disabled) return
      if (e.dataTransfer.items) {
        const files = await collectPdfsFromItems(e.dataTransfer.items)
        if (files.length) onFiles(files)
      } else {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles, onFiles, disabled]
  )

  const browseFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled) folderRef.current?.click()
  }

  return (
    <div
      className={`relative transition-all duration-300 select-none ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        border: `1px dashed ${dragging ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.2)'}`,
        borderRadius: '4px',
        background: dragging ? 'rgba(201,168,76,0.04)' : 'rgba(20,19,16,0.6)',
        boxShadow: dragging ? '0 0 32px rgba(201,168,76,0.08), inset 0 0 32px rgba(201,168,76,0.03)' : 'none',
        backdropFilter: 'blur(8px)',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && fileRef.current?.click()}
    >
      <input ref={fileRef}   type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={disabled} />
      <input ref={folderRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={disabled} />

      <div className="flex items-center justify-between px-8 py-6">
        {/* Left: upload arrow icon */}
        <div className="flex items-center gap-6">
          <div
            className="w-10 h-10 flex items-center justify-center transition-all duration-300"
            style={{
              border: `1px solid ${dragging ? 'rgba(201,168,76,0.6)' : 'rgba(201,168,76,0.25)'}`,
              borderRadius: '2px',
              transform: dragging ? 'translateY(-2px)' : 'none',
            }}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#C9A84C" strokeWidth="1.5">
              <path d="M12 16V8m0 0L9 11m3-3l3 3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 15v2a4 4 0 004 4h10a4 4 0 004-4v-2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="font-mono text-xs tracking-widest uppercase text-cream">
              {dragging ? 'Release to upload' : 'Drop PDFs here'}
            </p>
            <p className="font-mono text-[10px] tracking-wide text-faint mt-0.5">
              Thai invoices · PDF only · Subfolders supported
            </p>
          </div>
        </div>

        {/* Right: action links */}
        <div className="flex items-center gap-6">
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-5">
            <span className="font-mono text-[11px] tracking-widest uppercase text-gold hover:text-gold-light transition-colors">
              Browse files
            </span>
            <span
              className="font-mono text-[11px] tracking-widest uppercase text-muted hover:text-gold transition-colors cursor-pointer"
              onClick={browseFolder}
            >
              Browse folder
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
