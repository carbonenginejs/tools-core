import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/lint-private-references.js");

test("privacy checks inspect staged bytes and messages while allowing resource identifiers", () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
    const run = (cmd, args, input) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", input });
    const git = (...args) =>
    {
        const result = run("git", args);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    const lint = (...args) => run(process.execPath, ["scripts/lint-private-references.js", ...args]);
    try
    {
        fs.mkdirSync(path.join(root, "scripts"));
        fs.copyFileSync(source, path.join(root, "scripts/lint-private-references.js"));
        fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
        git("init", "-q");
        git("config", "user.name", "Test");
        git("config", "user.email", "test@example.invalid");
        const file = path.join(root, "example.txt");
        const blocked = [
            "Q" + ":/private", "q" + ":/private", "Q" + ":\\private",
            "R" + ":/private", "r" + ":\\private",
            "docs/" + "internal/example.md", "docs\\" + "projects\\example.md",
            "https://github.com/carbonenginejs/" + "private-docs/blob/main/example",
            ".claude" + "/notes", ".codex" + "/notes", ".agents" + "/notes"
        ];
        for (const value of blocked)
        {
            fs.writeFileSync(file, value);
            git("add", "example.txt");
            fs.writeFileSync(file, "clean working copy");
            const result = lint("--staged");
            assert.equal(result.status, 1, value);
            assert.ok(!result.stderr.includes(value), "diagnostics must not repeat private text");
            fs.writeFileSync(path.join(root, "message"), value);
            assert.equal(lint("--commit-msg", "message").status, 1, value);
        }
        fs.writeFileSync(file, 'resPath = "r' + ':/texture.dds"; translate("r' + ':/", "res:/");');
        git("add", "example.txt");
        assert.equal(lint("--staged").status, 0);
        fs.writeFileSync(file, "Q" + ":/unstaged");
        assert.equal(lint("--staged").status, 0, "working copy must not replace staged input");
        assert.equal(lint().status, 1);
        fs.writeFileSync(path.join(root, "message"), "Handle r" + ":/ resource aliases");
        assert.equal(lint("--commit-msg", "message").status, 0);
        assert.equal(lint("--commit-msg", "missing").status, 1);
        fs.writeFileSync(file, "clean");
        git("add", "example.txt");
        git("commit", "-qm", "Initial fixture");
        // Stage only link-mode metadata and target bytes; never create or follow a link.
        const originalBlob = git("rev-parse", "HEAD:example.txt");
        const targetBlob = run("git", ["hash-object", "-w", "--stdin"], ".agents" + "/synthetic-note");
        assert.equal(targetBlob.status, 0, targetBlob.stderr);
        git("update-index", "--cacheinfo", "120000", targetBlob.stdout.trim(), "example.txt");
        assert.equal(git("diff", "--cached", "--name-status"), "T\texample.txt");
        const typeChange = lint("--staged");
        assert.equal(typeChange.status, 1, "type-changed index blobs must be inspected");
        assert.match(typeChange.stderr, /agent workspace/u);
        git("update-index", "--cacheinfo", "100644", originalBlob, "example.txt");
        git("rm", "example.txt");
        assert.equal(lint("--staged").status, 0);
        const scripts = path.dirname(source);
        fs.copyFileSync(path.join(scripts, "install-privacy-hooks.js"), path.join(root, "scripts/install-privacy-hooks.js"));
        fs.mkdirSync(path.join(root, "scripts/git-hooks"));
        for (const name of ["pre-commit", "commit-msg"])
        {
            fs.copyFileSync(path.join(scripts, "git-hooks", name), path.join(root, "scripts/git-hooks", name));
        }
        assert.equal(run(process.execPath, ["scripts/install-privacy-hooks.js"]).status, 0);
        fs.writeFileSync(file, "Q" + ":/private");
        git("add", "example.txt");
        assert.notEqual(run("git", ["commit", "-qm", "Safe message"]).status, 0);
        fs.writeFileSync(file, "clean new content");
        git("add", "example.txt");
        assert.notEqual(run("git", ["commit", "-qm", "Q" + ":/private"]).status, 0);
        git("commit", "-qm", "Handle r" + ":/ aliases");
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
