// Opens the EVE ONLINE login in a browser. Nothing to do with npm - npm is
// only the task runner here, which is why the script is named login:eve.
// The tools service must already be running.
//
// Exists because the flow is otherwise "read the docs, find the port, type a
// url" - which is fine for a test and poor for a person.
import { spawn } from "node:child_process";

const port = process.argv[2] ?? process.env.CJS_TOOLS_PORT ?? "5510";
const root = `http://localhost:${port}`;

let health;

try
{
    health = await (await fetch(`${root}/v1/health`)).json();
}
catch
{
    process.stderr.write(`No tools service on ${root}. Start one with: npm run server\n`);
    process.exit(1);
}

if (!health.capabilities?.auth)
{
    process.stderr.write(
        "The service is running but EVE SSO is not configured.\n"
        + "Copy .env.example to .env and set CJS_ESI_CLIENT_ID, then restart it.\n",
    );
    process.exit(1);
}

const status = await (await fetch(`${root}/v1/auth/esi/status`)).json();

if (status.authenticated)
{
    const who = status.characterName ? ` as ${status.characterName}` : "";
    process.stdout.write(`Already signed in${who}. Nothing to do.\n`);
    process.exit(0);
}

const url = `${root}/v1/auth/esi/login`;
const opener = process.platform === "win32"
    ? [ "cmd", [ "/c", "start", "", url ] ]
    : process.platform === "darwin"
        ? [ "open", [ url ] ]
        : [ "xdg-open", [ url ] ];

process.stdout.write(`Opening ${url}\nIf no browser opens, paste that into one.\n`);

spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
