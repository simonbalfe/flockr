import { useMembers } from "@/api/hooks"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

type AvatarSize = "xs" | "md" | "lg"

const sizeClass: Record<AvatarSize, { person: string; agent: string }> = {
  xs: { person: "size-[18px] text-[10px]", agent: "size-[18px]   text-[10px]" },
  md: { person: "size-[30px] text-xs", agent: "size-[30px]   text-xs" },
  lg: { person: "size-11 text-[17px]", agent: "size-11   text-[17px]" },
}

export function MemberAvatar({ name, size = "md", className }: { name: string; size?: AvatarSize; className?: string }) {
  const members = useMembers()
  const isAgent = members.data?.find((m) => m.name === name)?.kind === "agent"
  const sizes = sizeClass[size]
  return (
    <Avatar className={cn(isAgent ? sizes.agent : sizes.person, className)} aria-hidden="true">
      <AvatarFallback className="bg-accent font-semibold text-foreground">{name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
