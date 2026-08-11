import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base:"/SimStudio-LEGO-Technic-Physics-Simulator/",
  plugins:[react()],
  build:{outDir:"pages-dist",emptyOutDir:true},
});
