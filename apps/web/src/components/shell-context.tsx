import { createContext, useContext } from "react"

interface Shell {
  openSidebar: () => void
  openPalette: () => void
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error("useShell must be used inside the app shell")
  return shell
}
