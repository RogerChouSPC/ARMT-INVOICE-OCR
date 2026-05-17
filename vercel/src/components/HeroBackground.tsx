import { motion } from 'framer-motion'

export default function HeroBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Top-left orb — primary blue */}
      <motion.div
        className="absolute w-[700px] h-[700px] rounded-full bg-primary/[0.07] dark:bg-primary/[0.18] blur-[130px]"
        animate={{ x: [0, 90, 0], y: [0, -70, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        style={{ top: '-25%', left: '-15%' }}
      />
      {/* Top-right orb — violet */}
      <motion.div
        className="absolute w-[550px] h-[550px] rounded-full bg-violet-500/[0.05] dark:bg-violet-500/[0.13] blur-[110px]"
        animate={{ x: [0, -80, 0], y: [0, 60, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut', delay: 8 }}
        style={{ top: '0%', right: '-12%' }}
      />
      {/* Bottom-center orb — cyan */}
      <motion.div
        className="absolute w-[620px] h-[620px] rounded-full bg-cyan-500/[0.04] dark:bg-cyan-500/[0.10] blur-[130px]"
        animate={{ x: [0, 60, 0], y: [0, 80, 0] }}
        transition={{ duration: 36, repeat: Infinity, ease: 'easeInOut', delay: 16 }}
        style={{ bottom: '-20%', left: '25%' }}
      />
    </div>
  )
}
