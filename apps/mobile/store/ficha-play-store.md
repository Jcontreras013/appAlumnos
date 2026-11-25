# Ficha de CONECTA en Google Play

Lo que se copia en Play Console. Los gráficos están en esta misma carpeta.

## Ficha principal (Crecimiento → Presencia en la tienda → Ficha principal)

**Nombre de la app** (máx. 30): `CONECTA – Plataforma escolar`

**Descripción breve** (máx. 80):

> Notas, asistencia, tareas, mensajes y biblioteca de su centro educativo.

**Descripción completa** (máx. 4000):

> CONECTA es la plataforma escolar de su centro educativo: maestros, dirección y familias, conectados.
>
> PARA LOS MAESTROS
> • Pase de lista en segundos, desde el celular y aun sin internet: se guarda y se envía al volver la señal.
> • Notas por parcial y de recuperación, con el cuadro listo para el SACE.
> • Planificación semanal con la plantilla del centro y un asistente con inteligencia artificial que prepara el borrador para revisar. Al asistente nunca van datos de los alumnos.
> • Mensajes con la dirección, sin usar el WhatsApp personal, con fotos, videos y documentos.
> • Biblioteca con los libros, guías y enlaces del grado.
>
> PARA LA DIRECCIÓN
> • Seguimiento del centro: notas atrasadas, asistencia del día y alumnos en riesgo, sin pedir informes.
> • Revisión de las planificaciones, conducta con actas, licencias y sustitutos, horario y avisos.
> • Documentos con el membrete del centro: circulares, actas, informes y constancias, en Word o PDF.
> • Calendario escolar con feriados y vacaciones.
>
> PARA LAS FAMILIAS
> • Notas, asistencia y tareas de sus hijos, el mismo día.
> • Alerta temprana: saben a tiempo si su hijo necesita apoyo.
> • Boleta de calificaciones y avisos del centro.
> • Los libros y guías del grado, para leer también sin internet.
>
> COLEGIOS BILINGÜES
> Año escolar de septiembre a junio, materias en inglés y boleta en español o inglés.
>
> SEGURO Y PRIVADO
> Cada persona ve solo lo que le corresponde: el maestro, sus secciones; cada familia, a sus hijos. La información viaja cifrada y se respalda todos los días.
>
> CONECTA es un servicio para centros educativos. Las cuentas las entrega el centro: si su centro usa CONECTA, pida su usuario en la secretaría.
>
> Desarrollado en Honduras por Jc-System.

**Gráficos:**

- Ícono de la app: `icono-512.png`
- Gráfico destacado: `grafico-destacado-1024x500.png`
- Capturas del teléfono (en este orden): `capturas/1-asistencia.png` … `capturas/5-mensajes.png`

## Configuración de la tienda

- **Categoría:** Educación. **Etiquetas:** educación, escuela, docentes, familias.
- **Correo de contacto:** uno de la empresa (aparece público en Google Play).
- **Sitio web:** `https://<dominio de CONECTA>`.
- **Política de privacidad:** `https://<dominio de CONECTA>/privacidad`.

## Contenido de la app (Política → Contenido de la app)

**Acceso a la app:** «Todas o algunas funciones están restringidas». Dar a Google las cuentas del
**centro de demostración** (flujo «Cargar el centro de demostración»; nunca de un centro real), con la
contraseña de `DEMO_PASSWORD` y la indicación «La verificación en dos pasos no se pide a maestros,
alumnos ni familias»:

- Maestra: `maestra@demo.jcsystemhn.com` (cuaderno, aula virtual: temas, tareas y exámenes).
- Familia: `familia@demo.jcsystemhn.com` (notas, asistencia y clases de sus dos hijos).
- Alumna: `alumna@demo.jcsystemhn.com` (sus clases, entregar tareas y presentar un examen).

**Anuncios:** No contiene anuncios.

**Público objetivo:** **18 años o más.** La usan el personal del centro y las familias (personas
adultas); no está dirigida a niños. Así no aplica el programa «Diseñada para familias».

**Clasificación del contenido:** categoría «Referencia, noticias o educación». Violencia, contenido
sexual, lenguaje, drogas, apuestas: **no**. ¿Los usuarios pueden comunicarse entre sí? **Sí** (mensajes
entre el personal del centro). ¿Comparte la ubicación? **No**. ¿Compras digitales? **No**.

**Seguridad de los datos:**

| Pregunta                       | Respuesta                                                             |
| ------------------------------ | --------------------------------------------------------------------- |
| ¿Recopila o comparte datos?    | Recopila: **sí**. Comparte con terceros: **no**                       |
| ¿Datos cifrados en tránsito?   | **Sí**                                                                |
| ¿Se puede pedir que se borren? | **Sí**, a través del centro educativo (ver la política de privacidad) |

| Tipo de dato                                                            | Para qué                                         | ¿Obligatorio?              |
| ----------------------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| Información personal: nombre                                            | Funciones de la app; administración de la cuenta | Sí                         |
| Información personal: correo                                            | Administración de la cuenta                      | Sí (o número de identidad) |
| Información personal: IDs de usuario                                    | Administración de la cuenta                      | Sí                         |
| Información personal: teléfono                                          | Funciones de la app (contacto del responsable)   | No                         |
| Información personal: otra (notas, asistencia, conducta de los alumnos) | Funciones de la app                              | Sí                         |
| Mensajes: otros mensajes en la app                                      | Funciones de la app                              | No                         |
| Fotos y videos                                                          | Funciones de la app (adjuntos de los mensajes)   | No                         |
| Archivos y documentos                                                   | Funciones de la app (adjuntos y biblioteca)      | No                         |
| ID del dispositivo u otros IDs                                          | Funciones de la app (avisos de mensajes)         | No                         |

Nada se usa para publicidad ni se vende. Al asistente de planificación con IA solo van la
asignatura, el grado, el tema y las indicaciones del docente, nunca datos de los alumnos.

## Versiones de prueba

1. **Prueba interna** (hasta 100 personas, sin revisión larga): subir el primer AAB aquí.
2. **Prueba cerrada:** las cuentas de desarrollador **personales** creadas desde noviembre de 2023
   necesitan **al menos 12 personas probando durante 14 días seguidos** antes de pedir producción.
   Las cuentas de **organización** no.
3. **Producción.**
