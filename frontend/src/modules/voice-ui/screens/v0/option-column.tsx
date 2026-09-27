import { cn } from '../../../../core/utils'

type OptionColumnProps = {
  index: number
  label: string
  hint?: string
  focused: boolean
  dwellProgress: number
  onSelect: () => void
  onFocusChange?: (focused: boolean) => void
}

export function OptionColumn({
  index,
  label,
  hint,
  focused,
  dwellProgress,
  onSelect,
  onFocusChange,
}: OptionColumnProps) {
  const progress = Math.min(Math.max(dwellProgress, 0), 1)

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onFocusChange?.(true)}
      onMouseLeave={() => onFocusChange?.(false)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      aria-label={`Option ${index}: ${label}`}
      aria-pressed={focused}
      className={cn(
        'group relative flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-4xl border p-6 text-left transition-all duration-300 ease-out md:p-10',
        'focus-visible:outline-none',
        focused
          ? 'scale-[1.01] border-primary/70 bg-card shadow-[0_0_0_1px_var(--color-primary),0_30px_80px_-20px_color-mix(in_oklch,var(--color-primary)_35%,transparent)]'
          : 'border-border bg-card/40 hover:bg-card/60',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex size-12 items-center justify-center rounded-full border font-mono text-lg transition-colors md:size-14 md:text-xl',
            focused
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground',
          )}
        >
          {index}
        </span>
        {focused && (
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary md:text-sm">
            {progress >= 1 ? 'Selected' : 'Hold gaze'}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {hint && (
          <span className="text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            {hint}
          </span>
        )}
        <span
          className={cn(
            'text-balance text-4xl font-semibold leading-[1.05] tracking-tight transition-colors md:text-5xl xl:text-6xl',
            focused ? 'text-foreground' : 'text-foreground/85',
          )}
        >
          {label}
        </span>
      </div>

      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1.5 bg-foreground/5"
      >
        <span
          className="block h-full origin-left bg-primary"
          style={{ transform: `scaleX(${focused ? progress : 0})` }}
        />
      </span>
    </button>
  )
}
