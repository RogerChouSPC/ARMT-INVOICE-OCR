import { motion } from 'framer-motion'

const COLS = [180, 120, 100, 140, 100, 160, 120, 100, 110, 100]

function ShimmerCell({ width, delay = 0 }: { width: number; delay?: number }) {
  return (
    <td className="px-3 py-3 border-b border-border" style={{ minWidth: width }}>
      <div
        className="h-3 rounded bg-muted animate-pulse"
        style={{ width: `${55 + (delay * 7) % 35}%`, animationDelay: `${delay}s` }}
      />
    </td>
  )
}

export default function TableSkeleton() {
  return (
    <motion.div
      className="card overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="table-container">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {COLS.map((w, i) => (
                <th key={i} className="px-3 py-2.5 text-left border-b border-border bg-muted" style={{ minWidth: w }}>
                  <div
                    className="h-3 rounded bg-border animate-pulse"
                    style={{ width: '55%', animationDelay: `${i * 0.05}s` }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((row) => (
              <tr key={row} className="hover:bg-muted/40">
                {COLS.map((w, col) => (
                  <ShimmerCell key={col} width={w} delay={row * 0.1 + col * 0.04} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
