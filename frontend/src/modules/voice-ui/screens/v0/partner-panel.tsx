import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '../../../../core/utils';

type PartnerPanelProps = {
  partnerText?: string;
  /** Newer speech held while the user chooses a reply (handled right after). */
  alsoSaid?: string;
  /** How the moment feels (partner's words + the user's face), with the reason as a tooltip. */
  feels?: { label: string; reason: string };
  status?: string;
  isListening?: boolean;
  /** Show the "type what your partner said" box (only while listening). */
  showInput?: boolean;
  onSendPartnerText?: (text: string) => void;
  /** Phase details under the text (reply being spoken, typed letters, the caregiver form...). */
  children?: ReactNode;
};

export function PartnerPanel({
  partnerText,
  alsoSaid,
  feels,
  status = 'Listening…',
  isListening = true,
  showInput = true,
  onSendPartnerText,
  children,
}: PartnerPanelProps) {
  const [draft, setDraft] = useState('');

  // Long turns scroll inside the panel; new words keep it at the latest line (unless the reader
  // scrolled up to read something earlier).
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [partnerText, alsoSaid]);
  const onScroll = () => {
    const el = box.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendPartnerText?.(text);
    setDraft('');
  }

  return (
    <section
      aria-label="What your partner said"
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl border border-border bg-card/55 p-5 backdrop-blur-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Partner said
          {feels && (
            <span
              title={feels.reason}
              className="rounded-full bg-foreground/6 px-2.5 py-1 normal-case tracking-normal"
            >
              Feels: {feels.label}
            </span>
          )}
        </h2>
        <span
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span
            className={cn(
              'size-2 rounded-full',
              isListening ? 'animate-iris-pulse bg-primary' : 'bg-muted-foreground/50',
            )}
          />
          {status}
        </span>
      </div>

      <div
        ref={box}
        onScroll={onScroll}
        tabIndex={0}
        className="max-h-[7.5em] overflow-y-auto overscroll-contain pr-1.5 text-2xl md:text-3xl"
      >
        <p
          aria-live="polite"
          className={cn(
            'min-h-[2.5em] text-pretty font-medium leading-snug',
            partnerText ? 'text-foreground' : 'text-muted-foreground/60',
          )}
        >
          {partnerText ? `“${partnerText}”` : 'Waiting for your partner to speak…'}
        </p>
        {alsoSaid && (
          <p className="mt-2 text-base italic text-muted-foreground">Also said: {alsoSaid}</p>
        )}
      </div>

      {children}

      {showInput && (
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
      )}
    </section>
  );
}
