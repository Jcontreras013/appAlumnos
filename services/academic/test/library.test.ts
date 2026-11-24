import { randomUUID } from "node:crypto";
import { memoryFileStore } from "@escolar/service-kit";
import type { LibraryItemDto, PortalAccessDto, StudentDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Biblioteca virtual: libros y guías por grado; las familias ven lo de los grados de sus hijos. */

let ctx: AcademicTestContext;
const store = memoryFileStore();
let director: TestUser;
let coordinator: TestUser;
let ana: TestUser;
let beto: TestUser;
let mom: TestUser;
let outsider: TestUser;
let grade1: string;
let grade2: string;
let math: string;
const schoolId = randomUUID();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2000, 65), Buffer.from("\n%%EOF")]);

const upload = (who: TestUser, body: Buffer, name: string, query: Record<string, string>, type = "") =>
  ctx.app
    .inject({
      method: "POST",
      url: `/library/files?${new URLSearchParams(query)}`,
      headers: {
        authorization: `Bearer ${who.token}`,
        "content-type": type || "application/octet-stream",
        "x-file-name": encodeURIComponent(name),
      },
      payload: body,
    })
    .then((res) => ({
      status: res.statusCode,
      body: res.json() as LibraryItemDto & { error?: { message: string } },
    }));

const download = (who: TestUser, id: string, range?: string) =>
  ctx.app.inject({
    method: "GET",
    url: `/library/${id}/file`,
    headers: { authorization: `Bearer ${who.token}`, ...(range ? { range } : {}) },
  });

const list = async (who: TestUser, query = "") =>
  (await ctx.call<LibraryItemDto[]>(who, "GET", `/library${query}`)).body;

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-23", files: store });
  director = await ctx.user("admin", schoolId, "Directora");
  coordinator = await ctx.user("coordinador", schoolId, "Coordinación");
  ana = await ctx.user("docente", schoolId, "Prof. Ana");
  beto = await ctx.user("docente", schoolId, "Prof. Beto");
  outsider = await ctx.user("admin", randomUUID(), "Otro centro");
  const s = await ctx.seedStructure(director);
  grade1 = s.grade.id;
  math = s.subject.id;
  grade2 = (
    await ctx.call<{ id: string }>(director, "POST", "/grades", { name: "Segundo grado", sortOrder: 2 })
  ).body.id;
  // La madre de Luis (primer grado) tiene acceso al portal.
  const secretary = await ctx.user("secretaria", schoolId, "Secretaría");
  const luis = (
    await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
      firstNames: "Luis",
      lastNames: "López",
      guardians: [guardian({ nationalId: "0801198501234" })],
      sectionId: s.sectionA.id,
    })
  ).body;
  const access = (
    await ctx.call<PortalAccessDto>(
      secretary,
      "POST",
      `/guardians/${luis.guardians[0]?.id}/portal-access`,
      {},
    )
  ).body;
  mom = await ctx.user("padre", schoolId, "María López", access.userId);
});
afterAll(() => ctx.close());

describe("biblioteca", () => {
  let book: LibraryItemDto;
  let staffOnly: LibraryItemDto;
  let otherGrade: LibraryItemDto;
  let link: LibraryItemDto;

  it("una maestra sube el libro de Matemáticas de primer grado para las familias", async () => {
    const res = await upload(ana, PDF, "Matemáticas 1° — Libro del alumno.pdf", {
      titulo: "Libro de Matemáticas",
      descripcion: "Libro de texto del alumno",
      grado: grade1,
      materia: math,
      para: "familias",
    });
    expect(res.status).toBe(201);
    book = res.body;
    expect(book).toMatchObject({
      kind: "archivo",
      title: "Libro de Matemáticas",
      gradeName: "Primer grado",
      subjectName: "Matemáticas",
      audience: "familias",
      uploadedByName: "Prof. Ana",
      canDelete: true,
      url: null,
      file: {
        name: "Matemáticas 1° — Libro del alumno.pdf",
        contentType: "application/pdf",
        size: PDF.length,
      },
    });
    const keys = [...store.files.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^biblioteca/${schoolId}/[0-9a-f-]+\\.pdf$`));
  });

  it("el tipo sale de la extensión si el navegador no lo dice; Word también se acepta", async () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 1)]);
    staffOnly = (
      await upload(beto, docx, "Guía docente.docx", {
        titulo: "Guía para el docente",
        grado: grade1,
        para: "personal",
      })
    ).body;
    expect(staffOnly.file?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    otherGrade = (
      await upload(ana, PDF, "lecturas.pdf", {
        titulo: "Lecturas de segundo",
        grado: grade2,
        para: "familias",
      })
    ).body;
    expect(otherGrade.gradeName).toBe("Segundo grado");
    // Un libro escaneado de varios MB también sube (no pasa por el límite de los formularios).
    const big = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024, 66)]);
    const res = await upload(
      ana,
      big,
      "escaneado.pdf",
      { titulo: "Libro escaneado", para: "personal" },
      "application/pdf",
    );
    expect(res.status).toBe(201);
    expect(res.body.file?.size).toBe(big.length);
    expect((await ctx.call(ana, "DELETE", `/library/${res.body.id}`)).status).toBe(204);
  });

  it("no acepta un archivo que no es lo que dice ser, ni programas, ni datos incompletos", async () => {
    const before = store.files.size;
    const fake = await upload(ana, Buffer.from("MZ\x90\x00 esto es un programa".repeat(5)), "libro.pdf", {
      titulo: "Libro falso",
      para: "familias",
    });
    expect(fake.status).toBe(415);
    const exe = await upload(ana, PDF, "instalador.exe", { titulo: "Programa", para: "personal" });
    expect(exe.status).toBe(415);
    const noTitle = await upload(ana, PDF, "libro.pdf", { titulo: "", para: "familias" });
    expect(noTitle.status).toBe(400);
    const badGrade = await upload(ana, PDF, "libro.pdf", {
      titulo: "Libro",
      grado: randomUUID(),
      para: "familias",
    });
    expect(badGrade.status).toBe(400);
    expect(store.files.size).toBe(before);
    expect((await list(director)).map((i) => i.title)).not.toContain("Libro falso");
  });

  it("también guarda enlaces (Educatrachos, videos), solo con https", async () => {
    const http = await ctx.call(ana, "POST", "/library/links", {
      title: "Video de fracciones",
      url: "http://ejemplo.hn/video",
      audience: "familias",
    });
    expect(http.status).toBe(400);
    const res = await ctx.call<LibraryItemDto>(ana, "POST", "/library/links", {
      title: "Educatrachos: libros de texto",
      url: "https://educatrachos.hn/libros",
      description: "",
      gradeId: "",
      subjectId: "",
      audience: "familias",
    });
    expect(res.status).toBe(201);
    link = res.body;
    expect(link).toMatchObject({
      kind: "enlace",
      url: "https://educatrachos.hn/libros",
      file: null,
      gradeId: null,
    });
  });

  it("el personal ve todo y filtra por grado y materia", async () => {
    expect((await list(beto)).map((i) => i.id).sort()).toEqual(
      [book.id, staffOnly.id, otherGrade.id, link.id].sort(),
    );
    expect((await list(beto, `?grado=${grade1}`)).map((i) => i.id).sort()).toEqual(
      [book.id, staffOnly.id].sort(),
    );
    expect((await list(beto, `?materia=${math}`)).map((i) => i.id)).toEqual([book.id]);
    // Beto ve el libro de Ana, pero no lo puede quitar.
    expect((await list(beto)).find((i) => i.id === book.id)?.canDelete).toBe(false);
    expect((await list(coordinator)).find((i) => i.id === book.id)?.canDelete).toBe(true);
  });

  it("la familia ve solo lo compartido con ellas para el grado de su hijo (y lo general)", async () => {
    const seen = await list(mom);
    expect(seen.map((i) => i.id).sort()).toEqual([book.id, link.id].sort());
    expect(seen.every((i) => !i.canDelete)).toBe(true);
    expect((await ctx.call<LibraryItemDto>(mom, "GET", `/library/${book.id}`)).body.title).toBe(
      "Libro de Matemáticas",
    );
    expect((await ctx.call(mom, "GET", `/library/${staffOnly.id}`)).status).toBe(404);
    expect((await download(mom, book.id)).statusCode).toBe(200);
    expect((await download(mom, staffOnly.id)).statusCode).toBe(404);
    expect((await download(mom, otherGrade.id)).statusCode).toBe(404);
    expect(
      (
        await ctx.call(mom, "POST", "/library/links", {
          title: "x",
          url: "https://x.hn",
          audience: "familias",
        })
      ).status,
    ).toBe(403);
    expect((await ctx.call(mom, "DELETE", `/library/${book.id}`)).status).toBe(403);
  });

  it("otro centro no ve ni baja nada", async () => {
    expect(await list(outsider)).toEqual([]);
    expect((await download(outsider, book.id)).statusCode).toBe(404);
  });

  it("entrega el PDF para leerlo en pantalla, y por tramos (el lector no baja el libro completo)", async () => {
    const full = await download(ana, book.id);
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("application/pdf");
    expect(String(full.headers["content-disposition"])).toMatch(/^inline;/);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["x-content-type-options"]).toBe("nosniff");
    expect(full.rawPayload.equals(PDF)).toBe(true);

    const part = await download(ana, book.id, "bytes=0-3");
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-3/${PDF.length}`);
    expect(part.payload).toBe("%PDF");
    const tail = await download(ana, book.id, "bytes=-5");
    expect(tail.payload).toBe("%%EOF");
    expect((await download(ana, book.id, `bytes=${PDF.length}-`)).statusCode).toBe(416);

    // Word se descarga.
    const word = await download(beto, staffOnly.id);
    expect(String(word.headers["content-disposition"])).toMatch(/^attachment;.*Gu%C3%ADa%20docente\.docx/);
  });

  it("no se borra un grado mientras tenga materiales en la biblioteca", async () => {
    const res = await ctx.call<{ error: { message: string } }>(director, "DELETE", `/grades/${grade2}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/biblioteca/);
  });

  it("solo quien lo subió, la dirección o la coordinación lo quitan; se borra también el archivo", async () => {
    expect((await ctx.call(beto, "DELETE", `/library/${book.id}`)).status).toBe(403);
    const keys = store.files.size;
    expect((await ctx.call(ana, "DELETE", `/library/${book.id}`)).status).toBe(204);
    expect(store.files.size).toBe(keys - 1);
    expect((await ctx.call(coordinator, "DELETE", `/library/${otherGrade.id}`)).status).toBe(204);
    expect((await ctx.call(coordinator, "DELETE", `/library/${link.id}`)).status).toBe(204);
    expect((await list(mom)).map((i) => i.id)).toEqual([]);
    expect((await download(ana, book.id)).statusCode).toBe(404);
    expect((await ctx.call(director, "DELETE", `/grades/${grade2}`)).status).toBe(204);
  });
});
