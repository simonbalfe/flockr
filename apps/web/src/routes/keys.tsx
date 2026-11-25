import { useMayManageKeys } from "@/api/auth"
import { KeyList, NewKeyDialog } from "@/components/keys/keys"
import { PageHeader } from "@/components/page-header"
import { ScrollArea } from "@/components/ui/scroll-area"

export function KeysView() {
  const mayManage = useMayManageKeys()
  return (
    <>
      <PageHeader title="Keys">
        <NewKeyDialog />
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="max-w-[720px] px-4 pt-5 pb-6 nav:pl-6">{mayManage ? <KeyList /> : <div className="text-sm text-faint">Only a person can see and make keys.</div>}</div>
      </ScrollArea>
    </>
  )
}
