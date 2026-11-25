import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacidad y datos personales" };

/*
 * Política de privacidad pública (sin iniciar sesión). Play Store pide su dirección para publicar la
 * app. CONTACTO_PRIVACIDAD (opcional): a quién escribir, además de la dirección del centro.
 */
export default function PrivacyPage() {
  const contact = process.env.CONTACTO_PRIVACIDAD?.trim();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-700 sm:px-6">
      <h1 className="text-2xl font-semibold text-slate-900">Privacidad y datos personales</h1>
      <p className="mt-2 text-sm text-slate-500">
        {APP_NAME}: plataforma escolar para centros educativos de Honduras (sitio web y app para Android).
      </p>

      <Section title="Quién es responsable de los datos">
        <p>
          Cada centro educativo es responsable de los datos de sus alumnos, familias y personal. {APP_NAME}{" "}
          los guarda y los procesa por encargo del centro, solo para la gestión escolar.
        </p>
      </Section>

      <Section title="Qué datos se guardan">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Del personal y las familias: nombre, correo o número de identidad para entrar, rol y teléfono de
            contacto.
          </li>
          <li>
            De los alumnos: nombre, datos de matrícula, notas, asistencia, planificación de clases, conducta y
            los responsables de cada alumno.
          </li>
          <li>
            De los alumnos con cuenta del aula virtual: su correo o número de identidad para entrar, las
            tareas que entregan (texto, fotos y documentos) y las respuestas de sus exámenes en línea.
          </li>
          <li>
            Mensajes entre la dirección y los maestros, y los archivos que se adjuntan, se suben a la
            biblioteca o se publican en el aula virtual.
          </li>
          <li>
            Datos técnicos mínimos para que funcione: la sesión abierta, la bitácora de cambios del centro y,
            si se activan los avisos, el identificador del teléfono para enviarlos.
          </li>
        </ul>
      </Section>

      <Section title="Para qué se usan">
        <p>
          Solo para que el centro lleve su registro escolar, informe a las familias y a las autoridades
          educativas que le corresponden. No hay publicidad, no se venden ni se comparten datos con terceros
          para otros fines, y no se usan herramientas de rastreo o analítica de terceros.
        </p>
        <p>
          El asistente de planificación envía a un proveedor de inteligencia artificial solo la asignatura, el
          grado, el tema y las indicaciones que escribe el maestro; nunca datos de los alumnos.
        </p>
      </Section>

      <Section title="Quién los ve">
        <ul className="list-disc space-y-1 pl-5">
          <li>El personal del centro, según su rol (por ejemplo, cada maestro ve sus secciones).</li>
          <li>Cada familia ve solo la información de sus hijos y lo que el centro comparte con ella.</li>
          <li>
            Cada alumno ve solo sus clases, tareas, exámenes y notas. Sus entregas y respuestas las ven sus
            maestros y su familia.
          </li>
          <li>La dirección departamental o distrital ve lo que le corresponde de los centros a su cargo.</li>
          <li>El equipo técnico de {APP_NAME}, solo para dar soporte cuando el centro lo pide.</li>
        </ul>
      </Section>

      <Section title="Alumnos menores de edad">
        <p>
          Las cuentas de los alumnos las crea el centro educativo, que es quien cuenta con la autorización de
          sus padres o encargados. Los alumnos no pueden escribir mensajes ni ver datos de otros alumnos, no
          hay publicidad y no se recopila su ubicación. Los padres o encargados pueden pedir al centro ver,
          corregir o borrar los datos de sus hijos, o cerrar su cuenta.
        </p>
      </Section>

      <Section title="Cómo se protegen">
        <p>
          La información viaja cifrada (HTTPS) y se guarda en servidores en la nube con copias de seguridad.
          Las contraseñas nunca se guardan tal cual (solo una huella cifrada); los archivos no tienen enlaces
          públicos y se entregan solo a quien tiene permiso de verlos.
        </p>
      </Section>

      <Section title="La app para Android">
        <p>
          La app abre {APP_NAME} y usa: internet; los avisos del teléfono, solo si se activan; la cámara o los
          archivos, solo cuando la persona elige adjuntar algo; y la carpeta «Descargas», para guardar lo que
          se descarga. Al cerrar sesión se borran del teléfono las páginas y los libros guardados para usar
          sin internet.
        </p>
      </Section>

      <Section title="Cuánto tiempo se guardan">
        <p>
          Mientras el centro use {APP_NAME} y lo que pida la normativa educativa sobre el registro escolar. Al
          terminar el servicio, el centro recibe sus datos y se borran de la plataforma.
        </p>
      </Section>

      <Section title="Sus derechos">
        <p>
          Puede pedir ver, corregir o borrar sus datos, o cerrar su cuenta, a la dirección de su centro
          educativo. Las cuentas las crea el centro, que es quien las da de baja.
          {contact ? ` También puede escribir a ${contact}.` : ""}
        </p>
      </Section>

      <p className="mt-10 text-xs text-slate-400">Última actualización: noviembre de 2026.</p>
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
