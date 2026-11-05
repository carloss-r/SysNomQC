export const THEME_STORAGE_KEY = "sysnomqc-theme";

// Se ejecuta antes de pintar la página para que el modo oscuro no parpadee en claro al recargar.
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
