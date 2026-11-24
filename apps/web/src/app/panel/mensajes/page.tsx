import { MESSAGING_ROLES } from "@escolar/shared";
import { ConversationList } from "@/components/messages/conversation-list";
import { NewConversation } from "@/components/messages/new-conversation";
import { PushToggle } from "@/components/messages/push-toggle";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";

export const metadata = { title: "Mensajes" };

export default async function MessagesPage() {
  const { accessToken } = await requireRole(...MESSAGING_ROLES);
  const [conversations, contacts, push] = await Promise.all([
    identity.conversations(accessToken),
    identity.messageContacts(accessToken),
    identity.pushKey(accessToken),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Mensajes</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Conversaciones con los maestros y la dirección del centro, sin dar tu número personal. Los
            mensajes quedan guardados y no se borran.
          </p>
        </div>
        <NewConversation contacts={contacts} />
      </div>
      <PushToggle publicKey={push.publicKey} nativeAvailable={push.nativeAvailable} />
      <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
        <ConversationList initial={conversations} />
        <div className="card hidden min-h-[20rem] place-items-center p-10 text-center text-sm text-slate-500 md:grid">
          Elige una conversación o toca «Nuevo mensaje».
        </div>
      </div>
    </div>
  );
}
