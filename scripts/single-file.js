// The single-file build always inlines every generated JS/CSS asset; no glob matcher needed.
export function singleFile() {
  return {
    name: "mailroom:inline-assets",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html) throw Error("Single-file build did not produce index.html");
      let source = String(html.source);
      const inlined = [];
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type === "chunk") {
          const code = asset.code.replace(/<(?=\/script>|!--)/gi, "\\x3C");
          const tag = `<script type="module" crossorigin src="./${name}"></script>`;
          if (!source.includes(tag)) throw Error(`Cannot inline script ${name}`);
          source = source.replace(tag, () => `<script type="module">${code}</script>`);
          inlined.push(name);
        } else if (name.endsWith(".css")) {
          const tag = `<link rel="stylesheet" crossorigin href="./${name}">`;
          if (!source.includes(tag)) throw Error(`Cannot inline stylesheet ${name}`);
          source = source.replace(tag, () => `<style>${asset.source}</style>`);
          inlined.push(name);
        }
      }
      if (Object.keys(bundle).some((name) => name !== "index.html" && !inlined.includes(name)))
        throw Error(
          `Single-file build contains external assets: ${Object.entries(bundle)
            .map(([n, a]) => `${n}:${a.type}`)
            .join(", ")}`,
        );
      for (const name of inlined) delete bundle[name];
      html.source = source;
      html.fileName = "mailroom.html";
    },
  };
}
