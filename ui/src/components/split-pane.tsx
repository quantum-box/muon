import { useState, useCallback, useRef, useEffect } from 'react'
import { cn } from '../lib/utils'

interface SplitPaneProps {
  direction?: 'horizontal' | 'vertical'
  defaultSize?: number
  minSize?: number
  maxSize?: number
  children: [React.ReactNode, React.ReactNode]
  className?: string
}

export function SplitPane({
  direction = 'vertical',
  defaultSize = 50,
  minSize = 20,
  maxSize = 80,
  children,
  className,
}: SplitPaneProps) {
  const [size, setSize] = useState(defaultSize)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    function handleMouseMove(e: MouseEvent) {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()

      let pct: number
      if (direction === 'vertical') {
        pct = ((e.clientX - rect.left) / rect.width) * 100
      } else {
        pct = ((e.clientY - rect.top) / rect.height) * 100
      }

      pct = Math.max(minSize, Math.min(maxSize, pct))
      setSize(pct)
    }

    function handleMouseUp() {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, direction, minSize, maxSize])

  const isVertical = direction === 'vertical'

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex overflow-hidden',
        isVertical ? 'flex-row' : 'flex-col',
        className,
      )}
    >
      {/* First pane */}
      <div
        style={isVertical ? { width: `${size}%` } : { height: `${size}%` }}
        className="overflow-hidden shrink-0"
      >
        {children[0]}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'shrink-0 flex items-center justify-center',
          isVertical
            ? 'w-1 split-handle bg-slate-700/50'
            : 'h-1 split-handle split-handle-h bg-slate-700/50',
          isDragging && 'bg-violet-500',
        )}
      >
        <div
          className={cn(
            'rounded-full bg-slate-500/50',
            isVertical ? 'w-0.5 h-6' : 'h-0.5 w-6',
            isDragging && 'bg-violet-400',
          )}
        />
      </div>

      {/* Second pane */}
      <div className="flex-1 overflow-hidden">
        {children[1]}
      </div>
    </div>
  )
}
