import type { ProfileColour } from "@flockr/client"
import { useMembers } from "@/api/hooks"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

type AvatarSize = "xs" | "md" | "lg"

const sizeClass: Record<AvatarSize, { person: string; agent: string }> = {
  xs: { person: "size-[18px] text-[10px]", agent: "size-[18px]   text-[10px]" },
  md: { person: "size-[30px] text-xs", agent: "size-[30px]   text-xs" },
  lg: { person: "size-11 text-[17px]", agent: "size-11   text-[17px]" },
}

const colourClass = {
  zinc: "bg-accent",
  red: "bg-red-500/30",
  orange: "bg-orange-500/30",
  amber: "bg-amber-500/30",
  green: "bg-green-500/30",
  teal: "bg-teal-500/30",
  blue: "bg-blue-500/30",
  violet: "bg-violet-500/30",
  pink: "bg-pink-500/30",
} as const satisfies Record<ProfileColour, string>

export function MemberAvatar({ name, size = "md", className }: { name: string; size?: AvatarSize; className?: string }) {
  const members = useMembers()
  const member = members.data?.find((m) => m.name === name)
  const isAgent = member?.kind === "agent"
  const sizes = sizeClass[size]
  return (
    <Avatar className={cn(isAgent ? sizes.agent : sizes.person, className)} aria-hidden="true">
      <AvatarFallback className={cn("font-semibold text-foreground", colourClass[member?.colour ?? "zinc"])}>{(member?.displayName ?? name).charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
