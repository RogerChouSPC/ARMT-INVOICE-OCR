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
      className={`
        card p-12 flex flex-col items-center justify-center gap-5
        border-2 border-dashed transition-all duration-200 select-none
        ${dragging ? 'border-primary bg-muted scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-muted/30'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && fileRef.current?.click()}
    >
      <input ref={fileRef}   type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={disabled} />
      <input ref={folderRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={disabled} />

      <div className={`w-16 h-16 rounded-3xl flex items-center justify-center transition-colors ${dragging ? 'bg-primary' : 'bg-muted'}`}>
        <svg viewBox="0 0 24 24" className={`w-8 h-8 transition-colors ${dragging ? 'fill-primary-foreground' : 'fill-primary'}`}>
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
        </svg>
      </div>

      <div className="text-center">
        <p className="text-lg font-semibold text-foreground">
          {dragging ? 'Drop PDFs or folders here' : 'Upload Invoice PDFs'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Drag & drop files or folders ·{' '}
          <span className="text-primary font-medium">browse files</span>
          {' · '}
          <span className="text-primary font-medium cursor-pointer hover:underline" onClick={browseFolder}>
            browse folder
          </span>
        </p>
        <p className="text-xs text-muted-foreground/60 mt-2">PDF files only · Thai language invoices · Subfolders supported</p>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          Google Vision OCR
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
          22-column Excel output
        </span>
      </div>
    </div>
  )
}
