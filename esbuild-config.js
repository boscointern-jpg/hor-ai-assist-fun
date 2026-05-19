const { build } = require("esbuild");
const path = require("path");

const SHORT_SHA = process.env.SHORT_SHA;
const BUILD_DIR = process.env.BUILD_DIR || "build"; // Add default

async function runBuild() {
  try {
    const result = await build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node22",
      sourcemap: true,
      minify: false,
      define: {
        "process.env.SHORT_SHA": `"${SHORT_SHA}"`,
      },
      external: ["@aws-sdk/*"],
      outfile: path.join(BUILD_DIR, "index.js"),
      // Add these for better alignment
      treeShaking: true,
      keepNames: true, // Helpful for Lambda debugging
    });
    console.log("Build complete:", result);
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

runBuild();
