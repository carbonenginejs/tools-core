# Reviewed generated enum refresh

Ordinary `renderEnums` emits unowned shared vocabulary and excludes class-owned
enums. Some installed legacy consumer modules predate that attribution and retain
owned exports used as aliases. Ordinary emission cannot reproduce those modules.

The internal `core/classTool.js` helper `refreshEnumRegistrations` supports a
reviewed migration of such a module. Supply the existing generated source, exact
source-qualified catalog records in export order, and registration metadata keyed
by export name. Chooser/member entries identify a declared `member`; the helper
resolves its number from the catalog. Catalog provenance and registry provenance
are independent inputs. Do not reconstruct chooser labels, exposure or registry
names from a bare enum declaration.

The helper accepts complete legacy frozen declarations (including extra blank
separators) or its own canonical registered output. It preserves the reviewed
header and newline style, retains unregistered exports as frozen objects, and
calls the dependency-free registry's Create after all declarations. Exact export,
member, value and registration checks reject drift and unknown executable code.
Repeated refresh is deterministic. Changes to values or metadata require a new
review of source and inputs; this preservation operation does not approve them.

No files are written by the helper, no consumer is installed automatically, and
ordinary generation's ownership filter is unchanged. The consumer owns reviewed
selectors, registration inputs, copy-in and its package validation.
