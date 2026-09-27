import { useId } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../core/utils';

export interface NavItem {
  name: string;
  url: string;
  icon: LucideIcon;
}

interface NavBarProps {
  items: readonly NavItem[];
  /**
   * "bar": a pill (floats at the bottom on phones; page names from laptop width, icons below).
   * "list": a full-width column, for the menu drawer.
   */
  variant?: 'bar' | 'list';
  className?: string;
  onNavigate?: () => void;
}

/**
 * Page links with a "tubelight": a glowing lamp that slides to the current page. The current page
 * comes from the URL (not the last click), so redirects and the back button move the lamp too.
 */
export function NavBar({ items, variant = 'bar', className, onNavigate }: NavBarProps) {
  // two navbars can be on screen at once (top bar + menu): each needs its own lamp
  const lampId = `lamp-${useId()}`;
  const list = variant === 'list';

  return (
    <MotionConfig reducedMotion="user">
      <nav
        aria-label="Pages"
        className={cn(
          list
            ? 'w-full'
            : 'fixed bottom-0 left-1/2 z-50 mb-6 -translate-x-1/2 md:static md:mb-0 md:translate-x-0',
          className,
        )}
      >
        <div
          className={cn(
            list
              ? 'isolate flex flex-col gap-1'
              : 'isolate flex items-center gap-1 rounded-full border border-border bg-background/60 p-1 shadow-lg backdrop-blur-lg md:gap-2 md:bg-background/5',
          )}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.url}
                to={item.url}
                end={item.url === '/'}
                onClick={onNavigate}
                aria-label={item.name}
                title={list ? undefined : item.name}
                className={({ isActive }) =>
                  cn(
                    'relative flex cursor-pointer items-center font-semibold no-underline transition-colors',
                    'text-foreground/70 hover:text-foreground',
                    list
                      ? 'gap-3 rounded-2xl px-5 py-3.5 text-lg'
                      : 'rounded-full px-3.5 py-2 text-sm md:px-5',
                    isActive && 'text-primary hover:text-primary',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {list ? (
                      <>
                        <Icon size={22} strokeWidth={2} aria-hidden="true" />
                        <span>{item.name}</span>
                      </>
                    ) : (
                      <>
                        <span className="hidden lg:inline">{item.name}</span>
                        <Icon
                          className="lg:hidden"
                          size={18}
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </>
                    )}
                    {isActive && <Lamp layoutId={lampId} vertical={list} />}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </MotionConfig>
  );
}

/**
 * The highlight behind the current link, with a small bright tube on its top edge (left edge in a
 * list). It carries the background too, so the whole highlight slides between links.
 */
function Lamp({ layoutId, vertical }: { layoutId: string; vertical: boolean }) {
  return (
    <motion.div
      layoutId={layoutId}
      className={cn(
        'absolute inset-0 -z-10 w-full bg-muted',
        vertical ? 'rounded-2xl' : 'rounded-full',
      )}
      initial={false}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {vertical ? (
        <div className="absolute top-1/2 -left-1 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary">
          <div className="absolute -top-2 -left-2 h-12 w-6 rounded-full bg-primary/20 blur-md" />
          <div className="absolute top-0 -left-1 h-8 w-6 rounded-full bg-primary/20 blur-md" />
          <div className="absolute top-2 left-0 h-4 w-4 rounded-full bg-primary/20 blur-sm" />
        </div>
      ) : (
        <div className="absolute -top-2 left-1/2 h-1 w-8 -translate-x-1/2 rounded-t-full bg-primary">
          <div className="absolute -top-2 -left-2 h-6 w-12 rounded-full bg-primary/20 blur-md" />
          <div className="absolute -top-1 h-6 w-8 rounded-full bg-primary/20 blur-md" />
          <div className="absolute top-0 left-2 h-4 w-4 rounded-full bg-primary/20 blur-sm" />
        </div>
      )}
    </motion.div>
  );
}
