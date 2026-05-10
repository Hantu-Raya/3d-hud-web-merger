import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://hantu-raya.github.io",
  base: "/3d-hud-web-merger/",
  integrations: [react()]
});
