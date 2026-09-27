import type { ReactNode } from 'react'
import { OptionColumn } from './option-column'
import { PartnerPanel } from './partner-panel'
import { CameraPanel, type TrackingStatus } from './camera-panel'

export type IrisOption = {
  label: string
  hint?: string
}

export type MainScreenProps = {
  options: IrisOption[]
  focusedIndex: number | null
  dwellProgress: number
  partnerText?: string
  status?: string
  isListening?: boolean
  tracking: TrackingStatus
  camera: ReactNode
  onSelect: (index: number) => void
  onFocusChange?: (index: number | null) => void
  onSendPartnerText?: (text: string) => void
  onCalibrate?: () => void
  onOpenMenu?: () => void
}

export function MainScreen({
  options,
  focusedIndex,
  dwellProgress,
  partnerText,
  status,
  isListening,
  tracking,
  camera,
  onSelect,
  onFocusChange,
  onSendPartnerText,
  onCalibrate,
  onOpenMenu,
}: MainScreenProps) {
  return (
    <main className="flex h-dvh flex-col gap-4 overflow-hidden bg-background p-4 md:gap-5 md:p-5">
      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:gap-5">
        <PartnerPanel
          partnerText={partnerText}
          status={status}
          isListening={isListening}
          onSendPartnerText={onSendPartnerText}
        />
        <CameraPanel
          camera={camera}
          tracking={tracking}
          onCalibrate={onCalibrate}
          onOpenMenu={onOpenMenu}
        />
      </header>

      <div
        role="group"
        aria-label="Reply options"
        className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3 md:gap-5"
      >
        {options.map((option, i) => (
          <OptionColumn
            key={option.label}
            index={i + 1}
            label={option.label}
            hint={option.hint}
            focused={focusedIndex === i}
            dwellProgress={focusedIndex === i ? dwellProgress : 0}
            onSelect={() => onSelect(i)}
            onFocusChange={(isFocused) => {
              if (isFocused) onFocusChange?.(i)
              else if (focusedIndex === i) onFocusChange?.(null)
            }}
          />
        ))}
      </div>
    </main>
  )
}
