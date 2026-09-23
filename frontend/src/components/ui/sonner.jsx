import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import OiPulseLogo from "@/components/OiPulseLogo";

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
      visibleToasts={mobile ? 1 : 4}
      closeButton
      icons={{
        success: <OiPulseLogo className="h-5 w-5 oi-alert-logo-success" pulse={false} />,
        error: <OiPulseLogo className="h-5 w-5 oi-alert-logo-error" pulse={false} />,
        warning: <OiPulseLogo className="h-5 w-5 oi-alert-logo-warning" pulse={false} />,
        info: <OiPulseLogo className="h-5 w-5 oi-alert-logo-info" pulse={false} />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast oi-browser-alert",
          title: "group-[.toast]:text-inherit",
          description: "group-[.toast]:text-inherit",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "oi-toast-close",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
