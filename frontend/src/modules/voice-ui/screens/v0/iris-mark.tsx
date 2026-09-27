export function IrisMark() {
  return (
    <div aria-hidden="true" className="relative flex aspect-square w-full max-w-md items-center justify-center">
      <div className="absolute inset-0 rounded-full border border-border" />
      <div className="absolute inset-[9%] rounded-full border border-primary/15" />
      <div className="absolute inset-[18%] rounded-full border border-primary/25 animate-iris-breathe" />
      <div className="absolute inset-[28%] rounded-full bg-[conic-gradient(from_0deg,var(--primary),oklch(0.55_0.09_205),var(--primary),oklch(0.62_0.1_180),var(--primary))] opacity-90" />
      <div className="absolute inset-[30.5%] rounded-full bg-[repeating-conic-gradient(from_0deg,oklch(0.165_0.025_255/0.35)_0deg_2deg,transparent_2deg_7deg)]" />
      <div className="absolute inset-[40%] rounded-full bg-background shadow-[0_0_0_6px] shadow-background/60" />
      <div className="absolute left-[53%] top-[42%] size-[5%] rounded-full bg-foreground/90" />
    </div>
  )
}
