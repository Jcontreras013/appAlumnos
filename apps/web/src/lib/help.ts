import type { Role } from "@escolar/shared";

/**
 * Manuales de uso por cargo. Se muestran en «Ayuda» y se pueden imprimir. Los nombres de botones y
 * pantallas van entre comillas tal como aparecen en el panel.
 */

export interface HelpSection {
  title: string;
  steps: string[];
  tip?: string;
}

export interface HelpGuide {
  key: string;
  title: string;
  intro: string;
  roles: Role[];
  sections: HelpSection[];
}

const FIRST_LOGIN: HelpSection = {
  title: "Entrar por primera vez",
  steps: [
    "Abre la dirección de la plataforma en el navegador del teléfono o la computadora.",
    "Escribe tu número de identidad (con o sin guiones) o tu correo, y la contraseña temporal que te entregaron en papel.",
    "La plataforma te pide elegir una contraseña nueva de al menos 10 caracteres (no sirven las más usadas, como «Honduras2026», ni solo números). Desde ahí entras siempre con ella.",
    "Si olvidas la contraseña, pide a quien te dio el acceso una «Nueva contraseña temporal».",
  ],
  tip: "Tras 5 intentos fallidos la cuenta se bloquea 15 minutos. Es para proteger los datos de los alumnos.",
};

const CALENDAR: HelpSection = {
  title: "Calendario escolar: feriados y vacaciones",
  steps: [
    "En «Calendario escolar», agrega cada feriado (un solo día) y cada período de vacaciones (desde y hasta).",
    "Esos días no se pide asistencia y ninguna clase aparece «sin maestro», aunque haya licencias.",
    "Una semana entera sin clases no pide planificación: nada queda atrasado. Si solo un día es feriado, el asistente de planificación lo deja fuera.",
    "Las familias ven los próximos días sin clases en el portal.",
    "Funciona igual con el año de febrero a noviembre o con el de septiembre a junio (colegios bilingües).",
  ],
  tip: "Lo marcan la secretaría y la dirección; el resto del personal solo lo consulta.",
};

const DOCUMENTS: HelpSection = {
  title: "Documentos: circulares, actas e informes",
  steps: [
    "En «Documentos», elige una plantilla: circular a padres, acta de reunión, informe, oficio, constancia, listado o documento en blanco. Ya trae el nombre del centro y la fecha.",
    "Escribe como en Word: títulos, negrita, listas y tablas (botón «Tabla»; con el cursor dentro, «+ Fila», «+ Columna» o «Unir» celdas).",
    "Toca «Guardar» (o Ctrl+S). En «Lo pueden ver» eliges si es solo tuyo o lo ve todo el personal.",
    "«Descargar Word» baja el archivo .docx con el membrete del centro; «Imprimir o PDF» abre la hoja lista para imprimir o guardar en PDF.",
    "De un documento que compartió otra persona puedes «Hacer una copia» para usarlo como formato.",
  ],
  tip: "Solo quien escribe un documento lo puede cambiar o borrar.",
};

const LIBRARY: HelpSection = {
  title: "Biblioteca: libros, guías y enlaces",
  steps: [
    "En «Biblioteca», toca «Agregar material». «Subir archivo» acepta PDF, Word, Excel y PowerPoint (hasta 80 MB, un libro escaneado entra); «Agregar enlace», una página como Educatrachos o un video.",
    "Elige el grado y la materia (o «Todo el centro») y quién lo puede ver: «Solo el personal» o «Personal y familias». Hay que elegirlo siempre: una guía con respuestas no debe llegar a las familias por descuido.",
    "Las familias ven solo lo de los grados de sus hijos y lo que es para todo el centro.",
    "Los PDF se leen ahí mismo con «Leer» (también en el teléfono y en la app); Word, Excel y PowerPoint se descargan.",
    "Con «Guardar para leer sin internet» el libro queda en el teléfono y se abre aunque no haya señal.",
  ],
  tip: "Solo quien lo subió, la dirección o la coordinación pueden quitar un material. Al cerrar sesión, los libros guardados se borran del teléfono.",
};

const MESSAGES: HelpSection = {
  title: "Mensajes con el personal",
  steps: [
    "En «Mensajes», toca «Nuevo mensaje» y elige a la persona (puedes buscarla por nombre). Por ahora es solo entre maestros y dirección.",
    "Escribe y toca «Enviar». Una marca (✓) quiere decir que se envió; dos marcas verdes (✓✓), que ya lo leyó.",
    "Para mandar fotos, videos o documentos, toca el clip (📎) junto al mensaje: «Foto o video» abre la cámara o la galería; «Documento», tus archivos PDF, Word, Excel o PowerPoint. Puedes elegir hasta 5 a la vez y agregar un mensaje antes de «Enviar».",
    "El número junto a «Mensajes» en el menú te dice cuántas conversaciones tienen algo sin leer.",
    "Para que el teléfono te avise, toca «Activar avisos» arriba de tus conversaciones. En iPhone, primero toca Compartir → «Agregar a inicio» y abre CONECTA desde ese ícono.",
  ],
  tip: "Los avisos llegan de lunes a viernes de 6:00 a. m. a 7:00 p. m.; lo que te escriban de noche te lo avisamos al empezar la jornada. Los mensajes y lo que se adjunta no se borran: quedan como registro del centro. Los videos pueden durar hasta un minuto; las fotos se achican solas para gastar menos datos.",
};

export const HELP_GUIDES: HelpGuide[] = [
  {
    key: "docente",
    title: "Docentes",
    intro:
      "Tu cuaderno en el teléfono: pasas asistencia y registras las notas de cada actividad, aun sin internet. La nota del parcial se calcula sola y queda lista para el SACE.",
    roles: ["docente", "admin", "coordinador"],
    sections: [
      FIRST_LOGIN,
      {
        title: "Usar el cuaderno sin internet",
        steps: [
          "Entra a «Mi cuaderno» una vez con internet. Cuando diga «Listo para usar sin internet en este dispositivo», ya puedes trabajar sin señal.",
          "Sin internet verás «Sin conexión». Todo lo que registres se guarda en el teléfono.",
          "Cuando vuelve la señal se envía solo y aparece «Todo guardado».",
        ],
        tip: "Si el teléfono es compartido, cierra sesión al terminar: se borran tus clases guardadas del dispositivo.",
      },
      {
        title: "Pasar asistencia",
        steps: [
          "En «Mi cuaderno», toca «Tomar asistencia de hoy» en tu sección.",
          "Marca a cada alumno: presente, ausente, tarde o justificada. «Todos presentes» marca a todos de una vez y luego corriges a quien faltó.",
          "Para corregir otro día, usa «Día anterior» o «Día siguiente».",
        ],
      },
      {
        title: "Registrar notas",
        steps: [
          "En «Mi cuaderno», toca «Notas →» en la clase.",
          "«Agregar actividad»: escribe el nombre (por ejemplo, «Tarea 1»), la fecha y cuánto «Vale (puntos)». Cada parcial reparte 100 puntos.",
          "Escribe los puntos de cada alumno. La columna de la derecha muestra cómo va: la «Proyección en base 100 con lo evaluado hasta ahora».",
          "Cuando la clase llega a «Parcial completo (100 puntos)» y todos tienen nota, la nota del parcial queda lista.",
        ],
        tip: "«Van reprobando» te avisa a tiempo qué alumnos necesitan apoyo, antes del cierre del parcial.",
      },
      {
        title: "Planificación semanal",
        steps: [
          "En «Planificación», elige la clase y la semana. Llena la plantilla del centro.",
          "Guarda las veces que quieras. Cuando esté lista, toca «Enviar a revisión» antes del plazo de la semana.",
          "Si te la devuelven, verás las observaciones: corrígela y vuelve a enviarla.",
          "Puedes copiar la planificación de una semana anterior para no empezar de cero.",
          "Si la materia se imparte en inglés (colegios bilingües), el asistente escribe el borrador en inglés.",
        ],
      },
      {
        title: "Fin de año: notas finales y recuperación",
        steps: [
          "En las notas de la clase, toca «Notas finales y recuperación».",
          "Verás la nota de cada parcial, el promedio y el resultado. La nota final es el promedio de los parciales.",
          "A quien no alcanzó la nota mínima, escríbele la nota de recuperación y toca «Guardar recuperación». Si alcanza la nota mínima, aprueba la materia.",
        ],
      },
      {
        title: "Horario y avisos",
        steps: [
          "En «Horario» ves tus clases de la semana, en todas tus secciones.",
          "En «Avisos» ves lo que la dirección publica para el personal.",
        ],
      },
      MESSAGES,
      DOCUMENTS,
      LIBRARY,
      {
        title: "Reportar un incidente de conducta",
        steps: [
          "En «Conducta», toca «Reportar un incidente».",
          "Busca al alumno por su nombre (solo aparecen los de tus secciones), elige la fecha, la gravedad y el tipo de falta, y describe qué pasó.",
          "La dirección o la coordinación deciden la medida. En «Conducta» ves tus reportes y lo que se decidió.",
          "Si te equivocaste, puedes «Borrar reporte» mientras no tenga una medida.",
          "En cada medida de tus reportes, «Imprimir acta» saca la hoja para que el alumno y su familia la firmen.",
          "Si un alumno está suspendido, en la lista de asistencia aparece «Suspendido hasta el…» y «Todos presentes» no lo marca.",
        ],
        tip: "La familia ve el tipo de falta y la medida, no tu descripción: puede nombrar a otros alumnos.",
      },
      {
        title: "Cuando cubres a un compañero",
        steps: [
          "Si la dirección te asigna como sustituto, la clase aparece en «Mi cuaderno» mientras dura la licencia.",
          "Pasas asistencia y registras notas igual que en tus clases. Al terminar la licencia, la clase vuelve sola a su titular.",
        ],
      },
    ],
  },
  {
    key: "direccion",
    title: "Dirección del centro",
    intro:
      "Organizas el centro, das acceso al personal y a las familias, y ves cada día la asistencia, las notas, las planificaciones y los alumnos en riesgo.",
    roles: ["admin"],
    sections: [
      FIRST_LOGIN,
      {
        title: "Dar acceso al personal",
        steps: [
          "En «Personal y usuarios», usa «Cargar personal desde Excel»: una fila por persona con nombre, identidad, correo (si tiene) y cargo.",
          "«Revisar archivo» muestra los errores de cada fila. Corrige el Excel hasta que no haya errores y confirma.",
          "Imprime la hoja de accesos: cada persona recibe su usuario y su contraseña temporal. No se vuelven a mostrar.",
          "Para una sola persona, usa el formulario «Nuevo usuario».",
          "Para corregir un nombre o una identidad mal escrita, usa «Corregir datos». Para cambiar el cargo, «Cambiar cargo».",
        ],
      },
      {
        title: "Organizar el año",
        steps: [
          "En «Estructura académica»: crea el año lectivo, ajusta las fechas de los parciales y la nota mínima.",
          "Agrega los grados, las secciones (con su cupo) y las materias. En los colegios bilingües, marca en cada materia si «se imparte en» español o inglés: el asistente de planificación escribe en ese idioma.",
          "Asigna qué docente da cada materia en cada sección.",
          "Si un docente se va, usa «Cambiar docente»: la clase pasa a la persona nueva con sus notas y planificaciones.",
          "Todo se puede corregir con «Editar». Lo que ya tiene alumnos o notas no se puede eliminar: el sistema te dice qué hacer.",
        ],
      },
      {
        title: "Licencias y sustitutos",
        steps: [
          "En «Licencias y sustitutos», «Registrar licencia» con el docente, el motivo y las fechas. Regístrala a más tardar el día que empieza.",
          "En «Clases sin maestro hoy», asigna quién cubre cada clase o usa «Cubrir todas».",
        ],
        tip: "La departamental ve en su tablero, el mismo día, las clases que quedan sin maestro.",
      },
      {
        title: "Seguimiento diario",
        steps: [
          "En «Seguimiento» ves el avance de notas de cada clase, la asistencia y los alumnos en riesgo por faltas o por notas bajas.",
          "Cuando faltan 7 días o menos para el cierre de notas, aparece un aviso con las clases atrasadas.",
          "Al cierre del parcial, descarga el «Cuadro de calificaciones para el SACE» de cada sección: un Excel con la identidad y la nota de cada alumno por materia.",
          "En «Planificación» revisas las planificaciones de la semana: «Aprobar» o «Devolver con observaciones».",
        ],
      },
      {
        title: "Alumnos en riesgo: seguimiento",
        steps: [
          "En «Seguimiento», cada alumno en riesgo dice si ya tiene seguimiento.",
          "«Registrar seguimiento»: anota qué se hizo (llamada, reunión, visita, referido a orientación…) y qué se acordó.",
          "Todo queda en la ficha del alumno, con la fecha y quién lo registró.",
        ],
      },
      {
        title: "Horario de clases",
        steps: [
          "En «Horario», escribe las horas de clase del centro (los recreos no se escriben).",
          "Elige una sección y, en cada día y hora, la clase que va. El sistema no deja poner a un docente en dos secciones a la misma hora.",
          "Los docentes ven su horario y las familias el de la sección de su hijo.",
        ],
      },
      {
        title: "Avisos",
        steps: [
          "En «Avisos», publica reuniones, entrega de boletas o suspensiones de clase.",
          "Elige si es para el personal, para las familias o para ambos, y si es solo para una sección. Vence solo (30 días si no dices otra fecha).",
          "Las familias lo ven en «Mis hijos».",
        ],
      },
      MESSAGES,
      DOCUMENTS,
      LIBRARY,
      CALENDAR,
      {
        title: "Traslados entre centros",
        steps: [
          "Para un alumno que se va: en su ficha, «Trasladar a otro centro» y elige el centro de destino. Se retira su matrícula aquí.",
          "El otro centro lo ve en «Traslados» con sus datos, sus responsables y sus notas del año, y lo «Recibe» en una sección.",
          "Para un alumno que llega: en «Traslados», elige la sección y toca «Recibir».",
        ],
      },
      {
        title: "Constancias y bitácora",
        steps: [
          "En la ficha del alumno, «Constancia de matrícula» abre la constancia lista para imprimir, firmar y sellar.",
          "«Bitácora» muestra quién hizo qué y cuándo en el centro. Nadie la puede modificar.",
        ],
      },
      {
        title: "Cierre del año y paso de grado",
        steps: [
          "Crea en «Estructura académica» el año lectivo siguiente. En «Cierre del año» puedes crear de una vez las mismas secciones.",
          "«Cierre del año» muestra cada sección: quiénes pasan de grado y quiénes repiten, según las notas finales y las recuperaciones.",
          "Decide los casos pendientes alumno por alumno, toca «Revisar» y luego «Matricular» en el año siguiente.",
          "Al final, marca el año nuevo como vigente en «Estructura académica».",
        ],
      },
      {
        title: "Conducta: incidentes y medidas",
        steps: [
          "En «Conducta» ves los incidentes del año. «Esperan decisión» filtra los que todavía no tienen medida.",
          "En cada incidente, «Decidir una medida»: llamado de atención, citación a la familia, compromiso de conducta, suspensión o expulsión. Escribe la nota para la familia: la ve en su portal.",
          "En el llamado de atención eliges si se avisa a la familia («Avisar a la familia»); si no, queda solo en el registro del centro. Lo demás siempre se le avisa.",
          "«Imprimir acta» saca la hoja de cada medida, con la identidad del alumno, su encargado y las líneas para firmar.",
          "La suspensión pide su primer y último día (máximo 30 días). La suspensión y la expulsión las decide solo la dirección.",
          "La expulsión retira la matrícula del alumno con esa fecha. Hay que confirmarla antes de registrarla.",
          "Mientras dura una suspensión, el alumno aparece «Suspendido hasta el…» en la lista de asistencia del maestro.",
          "Las medidas no se borran: si fue un error, «Anular» la deja en el historial como anulada. Anular una expulsión no vuelve a matricular: eso se hace desde la ficha del alumno.",
        ],
        tip: "Aplica las medidas según el reglamento interno del centro. La departamental ve cuántas suspensiones y expulsiones hay.",
      },
      {
        title: "Datos del centro",
        steps: [
          "«Exportar datos» descarga en Excel la matrícula, las notas de cada parcial y la asistencia del año.",
          "Son datos de menores: guárdalos con cuidado. Cada descarga queda registrada.",
        ],
      },
    ],
  },
  {
    key: "coordinacion",
    title: "Coordinación académica",
    intro:
      "Acompañas a los docentes: revisas sus planificaciones, el avance de las notas y a los alumnos en riesgo.",
    roles: ["coordinador"],
    sections: [
      FIRST_LOGIN,
      DOCUMENTS,
      LIBRARY,
      {
        title: "Revisar planificaciones",
        steps: [
          "En «Planificación» verás el tablero del centro con las planificaciones de la semana.",
          "Abre cada una y toca «Aprobar», o «Devolver con observaciones» claras para que el docente la corrija.",
        ],
      },
      {
        title: "Notas y alumnos en riesgo",
        steps: [
          "En «Seguimiento» revisa qué clases van atrasadas con las notas y qué alumnos están en riesgo.",
          "Habla con el docente a tiempo: la alerta aparece antes del cierre del parcial, cuando todavía se puede ayudar al alumno.",
        ],
      },
      {
        title: "Conducta",
        steps: [
          "En «Conducta» revisa los incidentes que reportan los docentes; «Esperan decisión» muestra los pendientes.",
          "Registra el llamado de atención, la citación a la familia o el compromiso de conducta, con una nota para la familia. En el llamado eliges si se le avisa.",
          "«Imprimir acta» saca la hoja de cada medida para firmarla.",
          "La suspensión y la expulsión las decide la dirección.",
        ],
      },
    ],
  },
  {
    key: "secretaria",
    title: "Secretaría",
    intro: "Llevas la matrícula, los datos de los alumnos y sus responsables, y das acceso a las familias.",
    roles: ["secretaria", "admin"],
    sections: [
      FIRST_LOGIN,
      DOCUMENTS,
      CALENDAR,
      {
        title: "Matrícula",
        steps: [
          "Para muchos alumnos a la vez: en «Alumnos», «Importar alumnos desde Excel». Revisa la vista previa y confirma.",
          "Para un alumno: «Nuevo alumno», con su responsable principal y la sección.",
          "En la ficha del alumno puedes «Cambiar de sección», «Registrar retiro» o volver a «Matricular».",
        ],
      },
      {
        title: "Responsables",
        steps: [
          "En la ficha del alumno, «Agregar responsable» para otro familiar.",
          "«Corregir datos» cambia el nombre, la identidad, el teléfono o el correo. Vale para todos sus hijos en el centro.",
          "«Hacer principal» indica a quién se llama primero.",
        ],
      },
      {
        title: "Acceso de las familias al portal",
        steps: [
          "En la ficha del alumno, junto al responsable, «Acceso al portal de familias».",
          "Imprime la carta: lleva el usuario (su identidad o correo) y una contraseña temporal. Al entrar, la familia elige la suya.",
          "Si la olvidan, desde el mismo lugar se da una nueva contraseña temporal.",
        ],
      },
      {
        title: "Boleta y constancia",
        steps: [
          "En la ficha del alumno, «Boleta» abre la boleta informativa lista para imprimir. Arriba se elige «Español» o «English».",
          "«Constancia de matrícula» abre la constancia para firmar y sellar.",
        ],
      },
      {
        title: "Traslados y avisos",
        steps: [
          "Si un alumno se va a otro centro del departamento: en su ficha, «Trasladar a otro centro».",
          "Los alumnos que llegan aparecen en «Traslados»: elige la sección y «Recibir».",
          "En «Avisos» puedes publicar avisos para las familias o el personal.",
        ],
      },
    ],
  },
  {
    key: "familias",
    title: "Familias",
    intro: "Ves las notas, la asistencia y las tareas de tus hijos el mismo día, desde el teléfono.",
    roles: ["padre"],
    sections: [
      {
        title: "Entrar",
        steps: [
          "El centro te entrega una carta con tu usuario (tu número de identidad o tu correo) y una contraseña temporal.",
          "Al entrar por primera vez eliges tu propia contraseña.",
          "Si la olvidas, pídele una nueva a la secretaría del centro.",
        ],
      },
      {
        title: "Ver a tus hijos",
        steps: [
          "En «Mis hijos» toca el nombre de cada hijo.",
          "Verás sus notas por materia y parcial, su asistencia, las faltas recientes y las tareas de la semana.",
          "Si aparece «Conviene hablar con sus maestros», acércate al centro: es una alerta temprana, todavía hay tiempo de ayudarlo.",
          "«Ver boleta» abre la boleta informativa para imprimir.",
          "Si el centro decidió una medida de conducta (por ejemplo, una citación o una suspensión), aparece en «Conducta» con la nota de la dirección.",
          "Más abajo está el horario de clases de su sección.",
          "Si el centro registró un llamado de atención o una medida y te la avisó, aparece en «Llamados de atención y medidas».",
          "Arriba de «Mis hijos» aparecen los avisos del centro.",
        ],
      },
      {
        title: "Biblioteca: libros y guías",
        steps: [
          "En «Biblioteca» están los libros de texto, guías y lecturas que el centro comparte para el grado de sus hijos.",
          "Toca «Leer» para abrir un libro en el teléfono. Con «−» y «+» cambias el tamaño; escribe un número en «Página» para saltar a esa página. La próxima vez te ofrece seguir donde te quedaste.",
          "Toca «Guardar para leer sin internet» y el libro queda en el teléfono: se abre aunque no haya señal ni saldo de datos.",
          "Los enlaces (como Educatrachos) se abren con «Abrir enlace».",
        ],
        tip: "Al cerrar sesión se borran los libros guardados en el teléfono.",
      },
    ],
  },
  {
    key: "regional",
    title: "Dirección departamental y distrital",
    intro:
      "Ves cada día cómo van todos los centros de tu ámbito: asistencia, docentes con licencia, clases sin maestro, notas, planificaciones y alumnos en riesgo.",
    roles: ["director_departamental", "director_distrital", "superadmin"],
    sections: [
      FIRST_LOGIN,
      {
        title: "Verificación en dos pasos",
        steps: [
          "Tu cuenta ve datos de muchos centros: la primera vez que entras, la plataforma te pide activar la verificación en dos pasos.",
          "Instala Google Authenticator o Microsoft Authenticator, escanea el código QR y escribe el código de 6 dígitos.",
          "Guarda los 10 códigos de recuperación: sirven si pierdes el teléfono.",
          "Desde entonces, al entrar escribes tu contraseña y el código que muestra la app.",
        ],
        tip: "Si pierdes el teléfono y los códigos, el equipo de la plataforma restablece tu verificación.",
      },
      {
        title: "Tablero de centros",
        steps: [
          "«Tablero de centros» muestra los totales del día y una fila por centro. Filtra por distrito o elige otra fecha.",
          "Arriba aparecen las alertas: clases sin maestro y centros atrasados con las notas.",
          "Toca un centro para ver su detalle, su personal y su matrícula por sección.",
        ],
      },
      {
        title: "Puesta en marcha (departamental)",
        steps: [
          "«Cargar centros» desde Excel: una fila por centro con su código, distrito, y el nombre y la identidad de su director.",
          "Imprime la hoja de accesos de los directores. Cada director carga luego a su personal.",
          "En el detalle de un centro puedes dar una «Nueva contraseña temporal» o «Corregir datos» de su personal.",
        ],
      },
      {
        title: "Indicadores del piloto y datos",
        steps: [
          "«Indicadores del piloto» mide las metas acordadas: cuentas activas, asistencia, notas, planificación, licencias, alerta temprana y familias.",
          "Elige el distrito del piloto y las fechas. Cada meta dice si se cumple, y la tabla de abajo muestra cada centro.",
          "«Descargar Excel» en el tablero baja el resumen de cada centro y la matrícula de todos.",
        ],
      },
    ],
  },
];

/** Las guías que le tocan a un cargo (la plataforma ve todas). */
export const guidesFor = (role: Role) =>
  role === "superadmin" ? HELP_GUIDES : HELP_GUIDES.filter((g) => g.roles.includes(role));
