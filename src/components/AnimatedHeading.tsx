import { useEffect, useState } from 'react'

interface AnimatedHeadingProps {
  text: string
  delay?: number
}

export function AnimatedHeading({ text, delay = 200 }: AnimatedHeadingProps) {
  const [visible, setVisible] = useState(false)
  const lines = text.split('\n')

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setVisible(true)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  return (
    <h1 className="hero-title text-4xl font-normal md:text-5xl lg:text-6xl xl:text-7xl">
      {lines.map((line, lineIndex) => (
        <span className="block" key={`${line}-${lineIndex}`}>
          {line.split('').map((character, characterIndex) => {
            const stagger = lineIndex * line.length * 30 + characterIndex * 30
            return (
              <span
                className={`animated-character ${visible ? 'is-visible' : ''}`}
                key={`${character}-${characterIndex}`}
                style={{ transitionDelay: `${stagger}ms` }}
              >
                {character === ' ' ? '\u00A0' : character}
              </span>
            )
          })}
        </span>
      ))}
    </h1>
  )
}
