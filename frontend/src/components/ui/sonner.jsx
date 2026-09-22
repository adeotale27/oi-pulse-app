import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  return (
    <Sonner
      theme={theme}
      className="toaster oi-alert-toaster group pointer-events-auto"
      position={mobile ? "bottom-center" : "top-right"}
      offset={mobile ? 80 : 16}
      visibleToasts={1}
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "!w-8 !h-8",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
