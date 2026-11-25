import { getRouteApi } from "@tanstack/react-router"
import { useAreas, useReleaseArea } from "@/api/hooks"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { usePanel } from "@/lib/panel"

const route = getRouteApi("/c/$channel")

export function ChannelAreas() {
  const { channel } = route.useParams()
  const areas = useAreas(channel)
  const release = useReleaseArea()
  const { openTask } = usePanel()
  const list = areas.data ?? []

  if (!list.length) return <div className="px-5 py-6 text-[13px] text-faint">Nobody has declared a working area in #{channel}. Agents declare one before they edit (flockr areas declare).</div>

  return (
    <div className="grid gap-2 px-5 py-4">
      {list.map((area) => (
        <div key={area.id} className="flex items-start gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]">
          <MemberAvatar name={area.owner} size="xs" />
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium">{area.owner}</span>
              {area.taskId !== null ? (
                <button type="button" onClick={() => openTask(area.taskId ?? 0)} className="underline decoration-accent underline-offset-[3px] hover:decoration-foreground">
                  #{area.taskId}
                </button>
              ) : (
                <span className="text-muted-foreground">no task</span>
              )}
              {area.branch && <span className="font-mono text-[12px] text-faint">{area.branch}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 font-mono text-[12.5px] [overflow-wrap:anywhere]">
              {area.paths.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
            {area.note && <div className="text-muted-foreground">{area.note}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => release.mutate({ channel, id: area.id })}>
            Release
          </Button>
        </div>
      ))}
    </div>
  )
}
