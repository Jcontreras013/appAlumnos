/** Estado que devuelven las server actions a sus formularios (`useActionState`). Seguro para el cliente. */
export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Errores por campo: { "email": "Correo inválido", "admin.password": "..." } */
  fields?: Record<string, string>;
  /** Valores enviados, para no borrar lo que la persona escribió cuando hay un error. */
  values?: Record<string, string>;
}

export const initialFormState: FormState = {};
