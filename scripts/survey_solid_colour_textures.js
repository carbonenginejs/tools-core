#!/usr/bin/env node
// Survey EVE textures that are a single solid colour.
//
// WHY. Thousands of EVE decal textures (res:/dx9/model/decal/**) are one flat
// colour stored as a whole DDS, often with a full mip chain. Carbon already
// resolves `dynamic:/color/r,g,b,a` at runtime (SolidColorTexture.cpp), which
// needs no file, no download and no decode - but CCP's editor does not let an
// artist type a dynamic path into a texture slot, so the files keep shipping.
// This script finds them by reading the pixels, so the list can go to CCP.
//
// HOW. It walks a build's resfileindex for every texture under a prefix,
// fetches each through the local tools-core service, decodes it with the
// runtime's ImageIO (block formats included), and checks whether every pixel of
// the top mip is the same colour, within a tolerance.
//
// RUN (tools-core service on 127.0.0.1:5510, runtime built: `npm run build:npm`):
//   node scripts/survey_solid_colour_textures.js
//   node scripts/survey_solid_colour_textures.js --prefix res:/dx9/model/decal/ --tolerance 1
//   node scripts/survey_solid_colour_textures.js --index <path to resfileindex.txt> --out <dir>
//
// OUTPUT. <out>/solid-colour-textures.md (grouped by colour, for people) and
// <out>/solid-colour-textures.csv (one row per file, for tools).
//
// COLOUR SPACE - READ BEFORE REPLACING ANYTHING. A dynamic colour texture is
// float and linear (R16G16B16A16_FLOAT). A decal stored in an _SRGB format is
// decoded from sRGB when sampled, so the equivalent dynamic value is the
// LINEARISED byte, not byte/255. The report gives both, and marks which one the
// suggested dynamic path uses. Whether a non-sRGB file is sampled as sRGB
// depends on the effect's texture slot, which this script cannot see.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RUNTIME_DIST = join(ROOT, "runtime", "npm", "dist");

const args = parseArgs(process.argv.slice(2));
const prefix = args.prefix ?? "res:/dx9/model/decal/";
const service = (args.service ?? "http://127.0.0.1:5510/eve/latest/resources/").replace(/\/?$/, "/");
const tolerance = Number(args.tolerance ?? 0);
const limit = args.limit ? Number(args.limit) : Infinity;
const outDir = resolve(args.out ?? join(ROOT, ".cache", "surveys"));

const { ImageIO, HostBitmap, LoadParameters } = await import(pathToFileURL(join(RUNTIME_DIST, "resource", "imageio", "index.js")));
const { CjsImageFormat } = await import(pathToFileURL(join(RUNTIME_DIST, "resource", "format", "index.js")));
const { PixelFormat } = await import(pathToFileURL(join(RUNTIME_DIST, "global", "consts", "renderContext", "index.js")));

const FORMAT_NAMES = new Map(Object.entries(PixelFormat).map(([ name, value ]) => [ value, name ]));

const index = args.index ?? await latestIndex();
const entries = (await readFile(index, "utf8"))
  .split(/\r?\n/)
  .map(line => line.split(","))
  .filter(([ path ]) => path?.toLowerCase().startsWith(prefix.toLowerCase()))
  .filter(([ path ]) => /\.(dds|png|jpe?g|tga)$/i.test(path))
  .slice(0, limit);

console.log(`index: ${index}`);
console.log(`scanning ${entries.length} textures under ${prefix} (tolerance ${tolerance})`);

const rows = [];
const failures = [];

for (const [ path, , , sizeText ] of entries)
{
  try
  {
    const row = await survey(path);
    row.bytes = Number(sizeText) || row.bytes;
    rows.push(row);
  }
  catch (error)
  {
    failures.push({ path, reason: error.message });
  }
  if ((rows.length + failures.length) % 250 === 0) console.log(`  ${rows.length + failures.length}/${entries.length}`);
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "solid-colour-textures.csv"), toCsv(rows));
await writeFile(join(outDir, "solid-colour-textures.md"), toMarkdown(rows, failures));

const solid = rows.filter(row => row.solid);
console.log(`solid: ${solid.length}/${rows.length}; distinct colours: ${new Set(solid.map(row => row.dynamicPath)).size}; failed: ${failures.length}`);
console.log(`bytes in solid files: ${solid.reduce((sum, row) => sum + row.bytes, 0)}`);
console.log(`report: ${join(outDir, "solid-colour-textures.md")}`);

/** Decode one texture and decide whether it is one colour. */
async function survey(path)
{
  const response = await fetch(service + path.replace(/^res:\//i, ""));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  const bitmap = new HostBitmap();
  const result = await ImageIO.readImageAsync(bytes, new LoadParameters(path), bitmap);
  if (!result.IsOk()) throw new Error(result.GetErrorMessage());

  const format = bitmap.GetFormat();
  const formatName = FORMAT_NAMES.get(format) ?? String(format);
  const srgb = formatName.endsWith("_SRGB");
  const width = bitmap.GetWidth();
  const height = bitmap.GetHeight();
  const mips = bitmap.GetTrueMipCount();

  // Top mip only, as BGRA bytes; block formats are decoded here.
  const top = new HostBitmap();
  top.Create(width, height, 1, format);
  top.GetMipRawData(0).set(bitmap.GetMipRawData(0).subarray(0, bitmap.GetMipSize(0)));
  const target = srgb ? PixelFormat.PIXEL_FORMAT_B8G8R8A8_UNORM_SRGB : PixelFormat.PIXEL_FORMAT_B8G8R8A8_UNORM;
  if (!CjsImageFormat.convertImage(top, target)) throw new Error(`cannot decode ${formatName}`);

  const data = top.GetMipRawData(0);
  const pitch = top.GetMipPitch(0);
  const min = [ 255, 255, 255, 255 ];
  const max = [ 0, 0, 0, 0 ];

  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      const at = y * pitch + x * 4;
      for (let c = 0; c < 4; c++)
      {
        const value = data[at + c];
        if (value < min[c]) min[c] = value;
        if (value > max[c]) max[c] = value;
      }
    }
  }

  const solid = max.every((value, c) => value - min[c] <= tolerance);
  // BGRA memory -> RGBA order; the midpoint of the observed range.
  const rgba = [ 2, 1, 0, 3 ].map(c => Math.round((min[c] + max[c]) / 2));
  const linear = rgba.map((byte, c) => c < 3 && srgb ? srgbToLinear(byte / 255) : byte / 255);
  const dynamicPath = `dynamic:/color/${linear.map(value => round(value)).join(",")}`;

  return {
    path, width, height, mips, format: formatName, srgb, solid,
    maxDeviation: Math.max(...max.map((value, c) => value - min[c])),
    rgbaBytes: rgba.join(" "),
    dynamicPath,
    bytes: bytes.byteLength
  };
}

function srgbToLinear(value)
{
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function round(value)
{
  return Number(value.toFixed(4));
}

async function latestIndex()
{
  const builds = join(ROOT, ".cache", "tool-core", "targets", "eve", "builds");
  if (!existsSync(builds)) throw new Error("no cached builds; pass --index <resfileindex.txt>");
  const numbers = (await readdir(builds)).filter(name => /^\d+$/.test(name)).sort((a, b) => Number(b) - Number(a));
  for (const build of numbers)
  {
    const file = join(builds, build, "indexes", "resfileindex.txt");
    if (existsSync(file)) return file;
  }
  throw new Error("no resfileindex.txt found; pass --index");
}

function toCsv(list)
{
  const header = "path,width,height,mips,format,srgb,solid,maxDeviation,rgbaBytes,dynamicPath,bytes";
  return [ header, ...list.map(row => [
    row.path, row.width, row.height, row.mips, row.format, row.srgb, row.solid,
    row.maxDeviation, row.rgbaBytes, row.dynamicPath, row.bytes
  ].join(",")) ].join("\n") + "\n";
}

function toMarkdown(list, failed)
{
  const solid = list.filter(row => row.solid);
  const byColour = new Map();
  for (const row of solid)
  {
    if (!byColour.has(row.dynamicPath)) byColour.set(row.dynamicPath, []);
    byColour.get(row.dynamicPath).push(row);
  }

  const lines = [
    "# Solid-colour textures",
    "",
    `Scanned ${list.length} textures under \`${prefix}\` (tolerance ${tolerance}); `
      + `${solid.length} are a single colour, in ${byColour.size} distinct colours, `
      + `${solid.reduce((sum, row) => sum + row.bytes, 0)} bytes in total.`,
    "",
    "Each could be `dynamic:/color/r,g,b,a` - Carbon resolves that at runtime "
      + "(SolidColorTexture.cpp) with no file, download or decode. CCP's editor does "
      + "not currently accept a dynamic path in a texture slot.",
    "",
    "Values are linear floats: sRGB files are linearised, others are byte/255. "
      + "Check the slot's colour space before replacing a non-sRGB file.",
    ""
  ];

  for (const [ dynamicPath, rowsForColour ] of [ ...byColour ].sort((a, b) => b[1].length - a[1].length))
  {
    lines.push(`## \`${dynamicPath}\` - ${rowsForColour.length} file(s), bytes RGBA ${rowsForColour[0].rgbaBytes}`, "");
    for (const row of rowsForColour)
    {
      lines.push(`- \`${row.path}\` ${row.width}x${row.height}, ${row.mips} mip(s), ${row.format}, ${row.bytes} bytes`);
    }
    lines.push("");
  }

  if (failed.length)
  {
    lines.push("## Could not be read", "");
    for (const { path, reason } of failed) lines.push(`- \`${path}\`: ${reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(list)
{
  const parsed = {};
  for (let i = 0; i < list.length; i++)
  {
    const match = /^--([\w-]+)$/.exec(list[i]);
    if (match) parsed[match[1]] = list[i + 1]?.startsWith("--") ? true : list[++i];
  }
  return parsed;
}
