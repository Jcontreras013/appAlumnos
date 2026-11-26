import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassChat } from "@/app/panel/aula/[id]/class-chat";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Chat de la clase" };

export default async function ClassChatPage({ params }: PageProps<"/panel/chats/[id]">) {
  const session = await requireRole("docente", "estudiante", "admin", "coordinador", "secretaria");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const chat = await academic.classChat(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/panel/chats" className="text-sm text-slate-500 hover:text-slate-900">
          ← Chats
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">
          {chat.subjectName} · {chat.sectionLabel}
        </h1>
        <p className="text-sm text-slate-500">
          {chat.teacherName ? `${chat.teacherName} · ` : ""}
          <Link href={`/panel/aula/${id}`} className="font-medium text-brand-700 hover:underline">
            Ir al aula de la clase
          </Link>
        </p>
      </div>
      <ClassChat assignmentId={id} initial={chat} full />
    </div>
  );
}
