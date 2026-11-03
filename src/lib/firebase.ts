// FOTOS DESHABILITADAS (por ahora).
//
// Este módulo guarda las fotografías de empleados en Firebase Storage. Se dejó comentado
// a propósito y ya no lo importa ninguna parte de la aplicación. Para reactivarlo:
//   1. Descomenta el bloque de abajo.
//   2. Restaura la sección "Fotografía" y la lógica de fotos en src/app/page.tsx
//      (busca los comentarios "FOTOS DESHABILITADAS").
//   3. Publica firebase/storage.rules y habilita Authentication > Anónimo en Firebase.

// import { getApp, getApps, initializeApp } from "firebase/app";
// import { getAuth, signInAnonymously } from "firebase/auth";
// import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
//
// // La configuración web de Firebase no es secreta (la protegen las reglas de Storage),
// // por eso se incluyen valores por defecto; puedes sobrescribirlos con variables de entorno.
// const firebaseConfig = {
//   apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyDzyxseoVmEc9kxPMMel3D0XK-lJk56mDE",
//   authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "sysnomqc-31c0a.firebaseapp.com",
//   projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "sysnomqc-31c0a",
//   storageBucket:
//     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "sysnomqc-31c0a.firebasestorage.app",
//   messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "1096682668696",
//   appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:1096682668696:web:fdd774aef9ea8356bd46ed",
//   measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-W3V9N8RBN2",
// };
//
// /** Carpeta de Firebase Storage donde se guardan las fotos de empleados. */
// export const FIREBASE_PHOTO_FOLDER = "employee-photos";
//
// const firebaseApp = () => (getApps().length ? getApp() : initializeApp(firebaseConfig));
//
// /** Las fotos nuevas viven en Firebase; las anteriores (si existen) siguen en Supabase. */
// export const isFirebasePhotoPath = (path: string) => path.startsWith(`${FIREBASE_PHOTO_FOLDER}/`);
//
// async function ensureFirebaseSession() {
//   const auth = getAuth(firebaseApp());
//   if (!auth.currentUser) await signInAnonymously(auth);
// }
//
// export async function uploadPhotoToFirebase(file: File): Promise<string> {
//   await ensureFirebaseSession();
//   const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
//
//   // Generador de ID único robusto compatible con contextos no seguros (IPs locales)
//   const uniqueId = typeof crypto?.randomUUID === "function" 
//     ? crypto.randomUUID() 
//     : Math.random().toString(36).substring(2) + Date.now().toString(36);
//
//   const path = `${FIREBASE_PHOTO_FOLDER}/${uniqueId}.${extension}`;
//   await uploadBytes(ref(getStorage(firebaseApp()), path), file, { contentType: file.type });
//   return path;
// }
//
// export async function getFirebasePhotoUrl(path: string): Promise<string> {
//   await ensureFirebaseSession();
//   return getDownloadURL(ref(getStorage(firebaseApp()), path));
// }
//
// export async function deleteFirebasePhoto(path: string): Promise<void> {
//   await ensureFirebaseSession();
//   await deleteObject(ref(getStorage(firebaseApp()), path));
// }
//
// export async function signOutFirebase(): Promise<void> {
//   const auth = getAuth(firebaseApp());
//   if (auth.currentUser) await auth.signOut();
// }

export {};
