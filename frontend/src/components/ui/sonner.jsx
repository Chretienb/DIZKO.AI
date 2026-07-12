import * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner } from "sonner"

// Dizko's theme lives on <html data-theme="...">, not next-themes — read it
// (and follow flips) so toasts match the active theme.
function useDataTheme() {
  const [theme, setTheme] = React.useState(() => document.documentElement.dataset.theme || "dark")
  React.useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || "dark"))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => obs.disconnect()
  }, [])
  return theme
}

const Toaster = ({ ...props }) => {
  const theme = useDataTheme()
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{
        "--normal-bg": "var(--surface-2)",
        "--normal-text": "var(--t1)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--r-2)",
        fontFamily: "var(--font-ui)",
      }}
      toastOptions={{ style: { boxShadow: "var(--shadow-2)" } }}
      {...props} />
  );
}

export { Toaster }
