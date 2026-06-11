import { motion, useReducedMotion } from 'framer-motion'

export default function HeroBackground() {
  const reduceMotion = useReducedMotion()
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Centre radial glow — primary blue */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,hsl(var(--primary)/0.18),transparent)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,hsl(var(--primary)/0.35),transparent)]" />

      {/* Top-left blob — primary */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full bg-primary/20 dark:bg-primary/30 blur-[80px]"
        animate={reduceMotion ? undefined : { x: [0, 80, 0], y: [0, -60, 0] }}
        transition={reduceMotion ? undefined : { duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        style={{ top: '-20%', left: '-10%' }}
      />

      {/* Top-right blob — violet */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-violet-500/15 dark:bg-violet-500/25 blur-[90px]"
        animate={reduceMotion ? undefined : { x: [0, -70, 0], y: [0, 50, 0] }}
        transition={reduceMotion ? undefined : { duration: 28, repeat: Infinity, ease: 'easeInOut', delay: 8 }}
        style={{ top: '-5%', right: '-8%' }}
      />

      {/* Bottom-center blob — cyan */}
      <motion.div
        className="absolute w-[550px] h-[550px] rounded-full bg-cyan-500/10 dark:bg-cyan-500/20 blur-[100px]"
        animate={reduceMotion ? undefined : { x: [0, 50, 0], y: [0, 70, 0] }}
        transition={reduceMotion ? undefined : { duration: 34, repeat: Infinity, ease: 'easeInOut', delay: 15 }}
        style={{ bottom: '-15%', left: '25%' }}
      />
    </div>
  )
}
