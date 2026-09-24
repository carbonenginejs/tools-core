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
//   node scripts/survey_solid_colour_textures.js --close 3     (relaxed-match distance, default 2)
//
// OUTPUT. <out>/solid-colour-textures.md (grouped by colour, for people),
// <out>/solid-colour-textures.csv (one row per file, for tools), and
// <out>/solid-colour-map.json - texture path -> its colour, the table a loader
// can use to substitute a dynamic colour instead of downloading the file.
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
// How far a colour may be from a shared file's and still be listed as close.
const closeTolerance = Number(args.close ?? 2);
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

matchShared(rows);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "solid-colour-textures.csv"), toCsv(rows));
await writeFile(join(outDir, "solid-colour-textures.md"), toMarkdown(rows, failures));
await writeFile(join(outDir, "solid-colour-map.json"), toMap(rows));

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

  // The published file answers the alpha question: the format says whether an
  // alpha channel exists at all, the pixels say what it holds.
  const alphaChannel = formatHasAlpha(formatName);
  const alphaMin = min[3];
  const alphaMax = max[3];
  const alphaState = !alphaChannel ? "none"
    : alphaMin >= 254 ? "opaque"
      : alphaMax === 0 ? "clear"
        : alphaMin === alphaMax ? "flat-partial" : "varies";

  return {
    path, width, height, mips, format: formatName, srgb, solid, alphaChannel, alphaState,
    maxDeviation: Math.max(...max.map((value, c) => value - min[c])),
    rgbaBytes: rgba.join(" "),
    dynamicPath,
    bytes: bytes.byteLength
  };
}

/**
 * Step one of the replacement plan: point each one-off solid texture at an
 * existing shared file of the same colour. Matches need identical RGBA bytes
 * and the same colour space, so a flat normal only maps to a shared normal;
 * a `_lowdetail` file maps to a `_lowdetail` shared file.
 */
function matchShared(list)
{
  const key = row => `${row.rgbaBytes}|${row.srgb}|${/_lowdetail\.[a-z]+$/i.test(row.path)}`;
  const shared = new Map();

  for (const row of list)
  {
    if (row.solid && /\/shared\//i.test(row.path) && !shared.has(key(row))) shared.set(key(row), row.path);
  }

  const sharedRows = list.filter(row => row.solid && /\/shared\//i.test(row.path) && !/\/shared\/normal_/i.test(row.path));
  const flatNormal = list.find(row => /\/shared\/normal_flat\.[a-z]+$/i.test(row.path))?.path ?? null;
  const flatNormalLow = list.find(row => /\/shared\/normal_flat_lowdetail\.[a-z]+$/i.test(row.path))?.path ?? null;

  for (const row of list)
  {
    if (!row.solid || /\/shared\//i.test(row.path)) continue;

    // Operator rule: a solid normal map (_n) maps to the shared flat normal.
    if (/_n(_lowdetail)?\.[a-z]+$/i.test(row.path))
    {
      row.sharedMatch = /_lowdetail\./i.test(row.path) ? (flatNormalLow ?? flatNormal) : flatNormal;
      continue;
    }

    row.sharedMatch = shared.get(key(row)) ?? null;
    if (row.sharedMatch) continue;

    const close = nearestShared(row, sharedRows);
    if (close)
    {
      row.closeMatch = close.path;
      row.closeDistance = close.distance;
    }
    else
    {
      row.proposedShared = proposeSharedName(row);
    }
  }
}

/**
 * The shared file nearest a colour, when every channel is within
 * `closeTolerance` - the relaxed rule. Same colour space and the same
 * `_lowdetail`-ness, as for an exact match.
 */
function nearestShared(row, sharedRows)
{
  const bytes = row.rgbaBytes.split(" ").map(Number);
  const low = /_lowdetail\./i.test(row.path);
  let best = null;

  for (const candidate of sharedRows)
  {
    if (candidate.srgb !== row.srgb || /_lowdetail\./i.test(candidate.path) !== low) continue;
    const other = candidate.rgbaBytes.split(" ").map(Number);
    const distance = Math.max(...bytes.map((value, c) => Math.abs(value - other[c])));
    if (distance <= closeTolerance && (!best || distance < best.distance)) best = { path: candidate.path, distance };
  }
  return best;
}

/**
 * A name for a new shared file, in the shared folder's own convention:
 * family_HHH_SSS_VVV - hue in degrees, saturation and value in percent, read
 * from the stored colour (blue_220_010_080 stores 180,186,202). The family is
 * "bw" when there is next to no saturation, otherwise a hue bucket.
 */
function proposeSharedName(row)
{
  const [ red, green, blue ] = row.rgbaBytes.split(" ").map(Number).map(value => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0)
  {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = max === 0 ? 0 : delta / max;
  const buckets = [ [ 15, "red" ], [ 45, "orange" ], [ 70, "yellow" ], [ 160, "green" ], [ 195, "cyan" ], [ 260, "blue" ], [ 300, "purple" ], [ 345, "magenta" ], [ 360, "red" ] ];
  const family = saturation < 0.05 ? "bw" : buckets.find(([ limit ]) => hue < limit)[1];
  const pad = value => String(Math.round(value)).padStart(3, "0");
  const low = /_lowdetail\./i.test(row.path) ? "_lowdetail" : "";
  return `res:/dx9/model/decal/shared/${family}_${pad(saturation < 0.05 ? 0 : hue)}_${pad(saturation * 100)}_${pad(max * 100)}${low}.dds`;
}

/**
 * Whether a published pixel format stores alpha. BC1 can (one bit), BC2/BC3/BC7
 * do; BC4/BC5 are one and two channels; BGRX, R8, R8G8 and B5G6R5 have none -
 * a decoder reports 255 for those, which is not the file's.
 */
function formatHasAlpha(name)
{
  if (/BC4|BC5|BC6H|B8G8R8X8|B5G6R5|^PIXEL_FORMAT_R8_|^PIXEL_FORMAT_R8G8_|^PIXEL_FORMAT_R16_|R32G32B32_/.test(name)) return false;
  return /BC1|BC2|BC3|BC7|A8|A16|A32|A2|A1/.test(name);
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

/** Texture path -> colour, solid files only, for substitution. */
function toMap(list)
{
  const map = {};
  for (const row of list.filter(item => item.solid))
  {
    map[row.path] = { alphaChannel: row.alphaChannel, alphaState: row.alphaState, sharedMatch: row.sharedMatch ?? null, closeMatch: row.closeMatch ?? null, closeDistance: row.closeDistance ?? null, proposedShared: row.proposedShared ?? null, dynamicPath: row.dynamicPath, rgbaBytes: row.rgbaBytes, srgb: row.srgb, format: row.format };
  }
  return `${JSON.stringify({ prefix, tolerance, count: Object.keys(map).length, textures: map }, null, 1)}\n`;
}

/** How many textures, solid and not, carry alpha - and what it holds. */
function alphaSummary(list)
{
  const count = (rows, state) => rows.filter(row => row.alphaState === state).length;
  const solidRows = list.filter(row => row.solid);
  const lines = [
    "## Alpha in the published files",
    "",
    "| alpha | all textures | solid textures |",
    "|---|---:|---:|"
  ];
  for (const [ state, meaning ] of [
    [ "none", "format has no alpha channel" ],
    [ "opaque", "alpha channel, every pixel 254-255" ],
    [ "clear", "alpha channel, every pixel 0" ],
    [ "flat-partial", "alpha channel, one value between" ],
    [ "varies", "alpha channel with real variation" ]
  ])
  {
    lines.push(`| ${state} - ${meaning} | ${count(list, state)} | ${count(solidRows, state)} |`);
  }
  lines.push("", "A solid texture whose alpha is `none` or `opaque` can take an opaque shared colour whether or not a shader reads alpha. `clear` and `flat-partial` must match on alpha.", "");
  return lines;
}

/** The two-step plan: re-point at shared files now, dynamic strings later. */
function replacementPlan(solid)
{
  const oneOff = solid.filter(row => !/\/shared\//i.test(row.path));
  const matched = oneOff.filter(row => row.sharedMatch);
  const close = oneOff.filter(row => row.closeMatch);
  const unmatched = oneOff.filter(row => !row.sharedMatch && !row.closeMatch);
  const missing = new Map();
  for (const row of unmatched)
  {
    const colour = `${row.proposedShared} (RGBA ${row.rgbaBytes}${row.srgb ? ", sRGB" : ""})`;
    missing.set(colour, (missing.get(colour) ?? 0) + 1);
  }

  const lines = [
    "## Replacement plan",
    "",
    "1. **Now:** re-point each one-off solid texture at the shared file of the same colour.",
    "2. **Later, once the editor accepts dynamic paths:** replace the shared files with `dynamic:/color/...`.",
    "",
    `${oneOff.length} one-off solid textures:`,
    "",
    `- ${matched.length} match a shared file exactly (solid \`_n\` normals map to the shared flat normal);`,
    `- ${close.length} are CLOSE to one - every channel within ${closeTolerance} levels (e.g. alpha 254 vs 255) - listed in the \`closeMatch\` column;`,
    `- ${unmatched.length} need one of ${missing.size} new shared files.`,
    "",
    "### New shared files needed (proposed name in the folder's HSV convention -> files that would use it)",
    ""
  ];
  for (const [ colour, count ] of [ ...missing ].sort((a, b) => b[1] - a[1])) lines.push(`- ${colour}: ${count}`);
  lines.push("");
  return lines;
}

function toCsv(list)
{
  const header = "path,width,height,mips,format,srgb,solid,alphaChannel,alphaState,maxDeviation,rgbaBytes,dynamicPath,bytes,sharedMatch,closeMatch,closeDistance,proposedShared";
  return [ header, ...list.map(row => [
    row.path, row.width, row.height, row.mips, row.format, row.srgb, row.solid, row.alphaChannel, row.alphaState,
    row.maxDeviation, row.rgbaBytes, row.dynamicPath, row.bytes, row.sharedMatch ?? "", row.closeMatch ?? "", row.closeDistance ?? "", row.proposedShared ?? ""
  ].map(csvField).join(",")) ].join("\n") + "\n";
}

/** Quote a CSV field that holds a comma or a quote: dynamic:/color/r,g,b,a does. */
function csvField(value)
{
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
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
    ...alphaSummary(list),
    ...replacementPlan(solid),
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
