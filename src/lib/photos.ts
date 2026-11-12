import { supabase } from "@/lib/supabase";

// Fotos de empleados: se comprimen en el navegador y se guardan en el bucket privado
// "employee-photos" de Supabase Storage. En la base solo se guarda la ruta del archivo.
export const PHOTO_BUCKET = "employee-photos";
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Tamaño máximo del archivo original (antes de comprimir). */
export const MAX_ORIGINAL_PHOTO_BYTES = 15 * 1024 * 1024;

const MAX_SIDE_PX = 800;
const TARGET_BYTES = 250 * 1024;
const QUALITIES = [0.82, 0.7, 0.55];
const SIGNED_URL_SECONDS = 60 * 60;

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Reduce la imagen a 800 px como máximo y la convierte a JPEG (normalmente < 150 KB). */
export async function compressPhoto(file: File): Promise<Blob> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Tu navegador no pudo procesar la imagen.");

  // Fondo blanco: los PNG/WebP con transparencia no deben quedar negros al pasar a JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let blob: Blob | null = null;
  for (const quality of QUALITIES) {
    blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  if (!blob) throw new Error("No se pudo comprimir la imagen.");
  return blob;
}

function newPhotoId() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Sube la foto ya comprimida y devuelve su ruta dentro del bucket. */
export async function uploadEmployeePhoto(photo: Blob): Promise<string> {
  const path = `${newPhotoId()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Enlaces firmados en memoria: se reutilizan mientras sigan vigentes y se borran al cerrar sesión.
const urlCache = new Map<string, string>();

export function getCachedPhotoUrl(path: string): string | undefined {
  return urlCache.get(path);
}

export function clearPhotoUrlCache() {
  urlCache.clear();
}

/** Enlace temporal para mostrar la foto (el bucket es privado). */
export async function getEmployeePhotoUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) return null;

  urlCache.set(path, data.signedUrl);
  // Se descarta antes de que el enlace expire para no reutilizar uno vencido.
  window.setTimeout(() => urlCache.delete(path), (SIGNED_URL_SECONDS - 600) * 1000);
  return data.signedUrl;
}

/** Elimina una foto; si falla no se interrumpe el flujo (queda un archivo huérfano). */
export async function deleteEmployeePhoto(path: string): Promise<void> {
  try {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  } catch (error) {
    console.error("No se pudo eliminar la foto anterior:", error);
  }
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
