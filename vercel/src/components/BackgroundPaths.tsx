import { useMemo } from 'react'
import { motion } from 'framer-motion'

function FloatingPaths({ position }: { position: number }) {
  const paths = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
        380 - i * 5 * position
      } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
        152 - i * 5 * position
      } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
        684 - i * 5 * position
      } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
      width: 0.5 + i * 0.03,
      opacity: 0.08 + i * 0.026,
      drawDuration: 1.5 + i * 0.08,
      drawDelay: i * 0.04,
    })),
    [position]
  )

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg
        className="w-full h-full text-slate-900 dark:text-white"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {/*
          One motion.g per FloatingPaths — a single GPU-composited transform
          drives the "alive" drift. No per-path stroke-dashoffset calculations.
        */}
        <motion.g
          animate={{
            x: [0, position * 45, 0],
            y: [0, -position * 18, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut',
            repeatType: 'mirror',
          }}
        >
          {paths.map((path) => (
            // pathLength 0 → 1 runs once on mount — gives the "draw in" reveal.
            // After that the path is static; only the parent <g> moves.
            <motion.path
              key={path.id}
              d={path.d}
              stroke="currentColor"
              strokeWidth={path.width}
              strokeOpacity={path.opacity}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: path.drawDuration,
                ease: 'easeOut',
                delay: path.drawDelay,
              }}
            />
          ))}
        </motion.g>
      </svg>
    </div>
  )
}

export default function BackgroundPaths() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[1]">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  )
}
