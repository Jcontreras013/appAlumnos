import { MESSAGING_ROLES } from "@escolar/shared";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Chat } from "@/components/messages/chat";
import { ConversationList } from "@/components/messages/conversation-list";
import { requireRole } from "@/lib/dal";
import { identity, ServiceError } from "@/lib/identity";

export const metadata = { title: "Mensajes" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accessToken } = await requireRole(...MESSAGING_ROLES);
  if (!z.uuid().safeParse(id).success) notFound();
  // Al abrirla quedan leídos los mensajes que llegaron.
  const conversation = await identity.conversation(accessToken, id, { read: true }).catch((err) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });
  const conversations = await identity.conversations(accessToken);
  return (
    <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
      <div className="hidden min-h-0 md:flex md:h-[calc(100dvh-12rem)] md:flex-col">
        <ConversationList initial={conversations} activeId={id} />
      </div>
      <Chat key={id} initial={conversation} />
    </div>
  );
}
