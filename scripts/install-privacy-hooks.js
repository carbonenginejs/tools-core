// Install privacy gates without replacing existing custom hooks.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooks = ["pre-commit", "commit-msg"];
const pending = [];
for (const name of hooks)
{
    const destination = execFileSync("git", ["rev-parse", "--git-path", `hooks/${name}`], { cwd: root, encoding: "utf8" }).trim();
    const target = path.resolve(root, destination);
    const source = Buffer.from(fs.readFileSync(path.join(root, "scripts", "git-hooks", name), "utf8").replace(/\r\n/gu, "\n"));
    if (fs.existsSync(target) && !fs.readFileSync(target).equals(source))
    {
        throw new Error(`Existing ${name} differs; integrate the privacy gate without replacing it.`);
    }
    pending.push({ target, source });
}
for (const entry of pending)
{
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    fs.writeFileSync(entry.target, entry.source, { mode: 0o755 });
}
console.log("Installed staged-content and commit-message privacy hooks.");
