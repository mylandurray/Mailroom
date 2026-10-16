// Arimo has Arial's metrics and covers Latin, Greek and Cyrillic, so names like Łukasz print.
// Vite turns these into asset URLs, or data: URLs in the single-file build.
import regularURL from "@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf?url";
import boldURL from "@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf?url";

const urls = { regular: regularURL, bold: boldURL };
const loads = {};
// Bold is only fetched when a design's text box asks for it.
export function fontBytes(weight = "regular") {
  loads[weight] ??= fetch(urls[weight])
    .then((response) => {
      if (!response.ok) throw Error();
      return response.arrayBuffer();
    })
    .then((buffer) => {
      // The preview uses the same bytes, so the single-file build only inlines each font once.
      if (typeof FontFace === "function")
        document.fonts.add(
          new FontFace("Arimo", buffer.slice(0), { weight: weight === "bold" ? "700" : "400" }),
        );
      return buffer;
    })
    .catch(() => {
      loads[weight] = null;
      throw Error("The label font could not be loaded. Reload the page and try again.");
    });
  return loads[weight];
}
