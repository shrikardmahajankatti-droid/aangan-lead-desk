// Lists Gemini models available to GEMINI_API_KEY and checks GEMINI_MODEL / the fallback.
// Usage: npm run check:gemini
import { GoogleGenAI } from "@google/genai";

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY is not set in .env.local");
  process.exit(1);
}
const wanted = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const fallback = "gemini-3.7-flash";
const ai = new GoogleGenAI({ apiKey: key });

// Some keys (e.g. org-issued "AQ." keys) can call generateContent but not models.list.
let names = null;
try {
  names = [];
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  for await (const m of pager) names.push(m.name.replace(/^models\//, ""));
  const flash = names.filter((n) => n.includes("flash")).sort();
  console.log("Flash models visible to this key:\n  " + flash.join("\n  "));
} catch (e) {
  names = null;
  console.log(`models.list not permitted for this key (${e.status ?? "error"}); testing models directly.`);
}

for (const model of [wanted, fallback]) {
  if (names && !names.includes(model)) {
    console.log(`✗ ${model}: not listed`);
    continue;
  }
  try {
    const r = await ai.models.generateContent({ model, contents: "Reply with the word ok." });
    console.log(`✓ ${model}: generateContent works (${r.text?.trim()})`);
    if (model !== wanted) console.log(`→ Set GEMINI_MODEL=${model}`);
    process.exit(0);
  } catch (e) {
    console.log(`✗ ${model}: ${e.message}`);
  }
}
process.exit(1);
