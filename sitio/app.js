// Sitio de Jc-System: menú del celular, animaciones al bajar, pestañas de CONECTA, video y el
// formulario que arma el mensaje de WhatsApp. Sin librerías ni datos que salgan del navegador.
const WHATSAPP = "50487764208";

// Barra con fondo al bajar.
const barra = document.getElementById("barra");
const alBajar = () => barra.classList.toggle("con-fondo", window.scrollY > 20);
alBajar();
window.addEventListener("scroll", alBajar, { passive: true });

// Menú del celular.
const hamburguesa = document.getElementById("hamburguesa");
const cerrarMenu = () => {
  document.body.classList.remove("menu-abierto");
  hamburguesa.setAttribute("aria-expanded", "false");
  hamburguesa.setAttribute("aria-label", "Abrir el menú");
};
hamburguesa.addEventListener("click", () => {
  const abierto = document.body.classList.toggle("menu-abierto");
  hamburguesa.setAttribute("aria-expanded", String(abierto));
  hamburguesa.setAttribute("aria-label", abierto ? "Cerrar el menú" : "Abrir el menú");
});
for (const enlace of document.querySelectorAll("#menu a")) enlace.addEventListener("click", cerrarMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarMenu();
});

// Lo que aparece al bajar: los elementos hermanos entran uno tras otro.
const aparecen = document.querySelectorAll(".aparece");
for (const el of aparecen) {
  const hermanos = [...el.parentElement.children].filter((h) => h.classList.contains("aparece"));
  el.style.setProperty("--retraso", `${Math.min(hermanos.indexOf(el), 6) * 0.08}s`);
}
if ("IntersectionObserver" in window) {
  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        entrada.target.classList.add("visible");
        observador.unobserve(entrada.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  for (const el of aparecen) observador.observe(el);
} else {
  for (const el of aparecen) el.classList.add("visible");
}

// Brillo que sigue al ratón en las tarjetas de soluciones.
for (const tarjeta of document.querySelectorAll(".tarjeta")) {
  tarjeta.addEventListener("pointermove", (e) => {
    const r = tarjeta.getBoundingClientRect();
    tarjeta.style.setProperty("--x", `${e.clientX - r.left}px`);
    tarjeta.style.setProperty("--y", `${e.clientY - r.top}px`);
  });
}

// Pestañas de CONECTA (maestros, alumnos, dirección) y de JC POS: cada grupo cambia solo sus paneles.
for (const lista of document.querySelectorAll(".vistas__pestanas")) {
  const pestanas = [...lista.querySelectorAll("[data-vista]")];
  const elegir = (boton) => {
    for (const p of pestanas) {
      const activa = p === boton;
      p.setAttribute("aria-selected", String(activa));
      p.tabIndex = activa ? 0 : -1;
      document.querySelector(`[data-panel="${p.dataset.vista}"]`).hidden = !activa;
    }
  };
  for (const boton of pestanas) {
    boton.addEventListener("click", () => elegir(boton));
    boton.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = pestanas.indexOf(boton) + (e.key === "ArrowRight" ? 1 : -1);
      const siguiente = pestanas[(i + pestanas.length) % pestanas.length];
      elegir(siguiente);
      siguiente.focus();
    });
  }
}

// Video de CONECTA: se carga solo cuando lo piden; al tocarlo, se oye.
const video = document.getElementById("video-conecta");
const reproducir = document.getElementById("reproducir");
reproducir.addEventListener("click", () => {
  video.muted = false;
  video.controls = true;
  video.play();
  video.parentElement.classList.add("reproduciendo");
});

// Formulario: arma el mensaje y abre WhatsApp (no se guarda nada en ningún servidor).
const formulario = document.getElementById("formulario");
const error = document.getElementById("error-formulario");
formulario.addEventListener("submit", (e) => {
  e.preventDefault();
  const datos = new FormData(formulario);
  const nombre = String(datos.get("nombre") || "").trim();
  if (!nombre) {
    error.hidden = false;
    formulario.elements.nombre.focus();
    return;
  }
  error.hidden = true;
  const empresa = String(datos.get("empresa") || "").trim();
  const mensaje = String(datos.get("mensaje") || "").trim();
  const texto = [
    `Hola, soy ${nombre}${empresa ? ` de ${empresa}` : ""}.`,
    `Me interesa: ${datos.get("interes")}.`,
    mensaje,
  ]
    .filter(Boolean)
    .join("\n");
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
});

document.getElementById("anio").textContent = String(new Date().getFullYear());
