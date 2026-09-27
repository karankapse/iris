'use client'

import { useState, type FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../../../../core/utils'

type PartnerPanelProps = {
  partnerText?: string
  status?: string
  isListening?: boolean
  onSendPartnerText?: (text: string) => void
}

export function PartnerPanel({
  partnerText,
  status = 'Listening…',
  isListening = true,
  onSendPartnerText,
}: PartnerPanelProps) {
  const [draft, setDraft] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSendPartnerText?.(text)
    setDraft('')
  }

  return (
    <section
      aria-label="What your partner said"
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl border border-border bg-card/55 p-5 backdrop-blur-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Partner said
        </h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span
            className={cn(
              'size-2 rounded-full',
              isListening ? 'animate-iris-pulse bg-primary' : 'bg-muted-foreground/50',
            )}
          />
          {status}
        </span>
      </div>

      <p
        aria-live="polite"
        className={cn(
          'min-h-[2.5em] text-pretty text-2xl font-medium leading-snug md:text-3xl',
          partnerText ? 'text-foreground' : 'text-muted-foreground/60',
        )}
      >
        {partnerText ? `\u201C${partnerText}\u201D` : 'Waiting for your partner to speak…'}
      </p>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label htmlFor="partner-input" className="sr-only">
          Type what your partner said
        </label>
        <input
          id="partner-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Or type what your partner said…"
          className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background/60 px-5 text-base text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>
    </section>
  )
}
