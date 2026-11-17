# Privacy checks

Run `node scripts/lint-private-references.js` for tracked working files,
`node scripts/lint-private-references.js --staged` for changed index blobs, or
`node scripts/lint-private-references.js --commit-msg FILE` for a proposed message.
Diagnostics give locations and rule names without repeating matched text.

Run `node scripts/install-privacy-hooks.js` once per checkout to install both
commit gates. Existing custom hooks are preserved: if installation refuses,
integrate these commands into them. Hooks are local Git configuration and must
be installed again in a new checkout.

Restricted filesystem drives are rejected in either case with backslashes;
forward-slash paths on the first restricted drive are also rejected in either
case. Lowercase `r:/` is the supported resource alias and remains allowed;
the uppercase spelling is treated as a filesystem path. The checker cannot distinguish
a filesystem path deliberately spelled like that resource alias.

Private documentation references and agent-workspace paths are prohibited.
Ignore files may name ignored infrastructure directories. Binary payloads are
not text-scanned. These checks do not replace review for confidential prose,
credentials, prohibited assets, or the actual package contents.
