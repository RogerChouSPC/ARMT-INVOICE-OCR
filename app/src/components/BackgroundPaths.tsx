import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

function FloatingPaths({ position }: { position: number }) {
  const reduceMotion = useReducedMotion()
  // useMemo so the array is never re-created on re-renders
  const paths = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
        380 - i * 5 * position
      } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
        152 - i * 5 * position
      } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
        684 - i * 5 * position
      } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
      // thinner widths
      width: 0.25 + i * 0.018,
      // deterministic duration — avoids Math.random() recalculating on every render
      // and spreads durations so paths never all peak simultaneously
      duration: 20 + i * 1.4,
      // stagger offset so each path starts at a different point in its cycle
      delay: i * 0.35,
    })),
    [position]
  )

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg
        className="w-full h-full text-slate-950 dark:text-white"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.1 + path.id * 0.03}
            initial={reduceMotion ? { pathLength: 1, opacity: 0.5 } : { pathLength: 0.3, opacity: 0.6 }}
            animate={reduceMotion ? { pathLength: 1, opacity: 0.5 } : {
              pathLength: 1,
              opacity: [0.3, 0.6, 0.3],
              pathOffset: [0, 1, 0],
            }}
            transition={reduceMotion ? undefined : {
              duration: path.duration,
              repeat: Infinity,
              ease: 'linear',
              delay: path.delay,
            }}
          />
        ))}
      </svg>
    </div>
  )
}

export default function BackgroundPaths({ dimmed = false }: { dimmed?: boolean }) {
  return (
    // Opacity is driven directly via inline style (not a JS-revealed class) so it
    // renders correctly on headless/first paint. In the empty/hero state the field
    // is full strength; once the operator is in the table zone it fades to a faint
    // 10% so it never reduces contrast behind dense data. The CSS transition is
    // auto-neutralised under prefers-reduced-motion by the global guard in index.css,
    // leaving just the lower static opacity (no animation).
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-[1]"
      style={{
        opacity: dimmed ? 0.1 : 1,
        transition: 'opacity 500ms ease-out',
      }}
    >
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  )
}
