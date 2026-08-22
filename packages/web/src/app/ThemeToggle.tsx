import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type Theme, useTheme } from './ThemeProvider.js'

const LIGHT = { value: 'light' as const, label: 'Light', Icon: Sun }
const DARK = { value: 'dark' as const, label: 'Dark', Icon: Moon }
const SYSTEM = { value: 'system' as const, label: 'System', Icon: Monitor }

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [LIGHT, DARK, SYSTEM]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // Indexing OPTIONS by a fixed position (e.g. OPTIONS[2]) types as possibly
  // undefined under noUncheckedIndexedAccess; falling back to the named
  // SYSTEM constant instead keeps this branch statically known-defined.
  const current = OPTIONS.find((o) => o.value === theme) ?? SYSTEM
  const CurrentIcon = current.Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Theme: ${current.label}`}>
          <CurrentIcon />
          {current.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
