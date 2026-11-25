import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Eliminar una cuenta" };

/*
 * Cómo pedir que se elimine una cuenta (pública, sin iniciar sesión). Google Play pide esta dirección
 * en «Seguridad de los datos». CONTACTO_PRIVACIDAD (opcional): a quién escribir, además del centro.
 */
export default function DeleteAccountPage() {
  const contact = process.env.CONTACTO_PRIVACIDAD?.trim();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-700 sm:px-6">
      <h1 className="text-2xl font-semibold text-slate-900">Eliminar una cuenta de {APP_NAME}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {APP_NAME}: plataforma escolar de Jc-System para centros educativos de Honduras (sitio web y app para
        Android).
      </p>

      <Section title="Quién puede pedirlo">
        <p>
          Cualquier persona con cuenta en {APP_NAME}: el personal del centro, las familias y los alumnos. Por
          un alumno menor de edad también puede pedirlo su padre, madre o encargado.
        </p>
      </Section>

      <Section title="Cómo pedirlo">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Pídalo a la dirección o a la secretaría de su centro educativo: diga su nombre y el correo o
            número de identidad con que entra a {APP_NAME}.
          </li>
          <li>El centro le quita el acceso de inmediato y pasa la solicitud a Jc-System.</li>
          <li>Jc-System elimina la cuenta en un máximo de 30 días desde la solicitud.</li>
          {contact ? (
            <li>
              Si no puede hacerlo por medio del centro, escriba a {contact} desde el correo de la cuenta.
            </li>
          ) : null}
        </ol>
      </Section>

      <Section title="Qué se borra">
        <p>
          La cuenta y sus datos para entrar: el correo o número de identidad, la contraseña, la verificación
          en dos pasos, las sesiones abiertas y el identificador del teléfono para los avisos. Desde ese
          momento ya no se puede entrar a {APP_NAME} con esa cuenta.
        </p>
      </Section>

      <Section title="Qué conserva el centro educativo">
        <p>
          El registro escolar que la normativa educativa obliga a guardar: matrícula, notas, asistencia,
          conducta, y las tareas y exámenes que entregó el alumno. Lo conserva el centro mientras use{" "}
          {APP_NAME}; al terminar el servicio, el centro recibe sus datos y se borran de la plataforma. Los
          mensajes que envió una persona del personal siguen visibles para quien los recibió. También se
          conserva la bitácora de cambios (quién hizo cada cambio y cuándo), que por seguridad no se modifica
          y puede incluir el correo con que se creó la cuenta.
        </p>
      </Section>

      <Section title="Copias de seguridad">
        <p>
          Las copias de seguridad se borran solas: las de la base de datos en un máximo de 30 días y las
          versiones anteriores de los archivos en un máximo de 90 días.
        </p>
      </Section>

      <p className="mt-10 text-xs text-slate-400">
        Más información en{" "}
        <a href="/privacidad" className="underline hover:text-slate-600">
          Privacidad y datos personales
        </a>
        . Última actualización: noviembre de 2026.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 space-y-2 text-sm leading-relaxed">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
