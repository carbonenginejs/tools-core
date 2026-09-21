# Telling Frontier's own assets from EVE placeholders

Status: Method
Visibility: Internal
Scope: Identifying which Frontier client files are genuinely Frontier's
Audience: Anyone browsing, cataloguing or previewing Frontier assets
Summary: Two thirds of Frontier's resource files are byte-identical copies of EVE's; the content hash separates them and the published flag does not.

## The problem

The Frontier client ships a large amount of EVE content as placeholder, so
browsing it by name, folder or `published` flag surfaces mostly EVE assets.
`published` does not discriminate: it is set on the copies too.

## The signal that works: the content hash

`resfileindex.txt` is `respath,resfile,md5,size,compressedSize`. The md5 is the
file's content hash, so a path present in both clients with the SAME md5 is a
byte-identical copy, and anything else is Frontier's own.

Measured, Frontier build 3474408 against EVE 3503375:

| | files |
| --- | --- |
| Frontier total | 47,857 |
| same path, identical bytes — copied from EVE | 31,950 |
| same path, different bytes — Frontier's own | 5,030 |
| path absent from EVE — Frontier's own | 10,877 |

Two thirds are copies. The remaining 15,907 are what somebody browsing Frontier
actually wants to see.

## Where Frontier's own content is

Own versus copied, by area:

| prefix | own | copied |
| --- | --- | --- |
| `dx9/model/spaceobjectfactory` | 2,594 | 612 |
| `dx9/model/celestial` | 2,148 | 117 |
| `dx9/model/worldobject` | 1,237 | 99 |
| `ui/texture/classes` | 1,032 | 2,739 |
| `dx9/model/turret` | 853 | 811 |
| `ui/texture/icons` | 775 | 3,215 |
| `dx9/texture/shared` | 374 | 0 |
| `dx9/model/ship` | 323 | 51 |

The UI icon trees are where the copies concentrate; the model trees are mostly
Frontier's own.

## Ships specifically

Of 121 ship folders: **89 are entirely Frontier**, 2 are mixed, and 30 are
entirely copied — and every one of those 30 is a decal texture rather than a
hull. So no Frontier ship hull is an EVE copy.

The Frontier-only hull families are named for its own factions — `traditionalist`
(corvette, frigate, battlecruiser), `dataist`, `rnd/modular`, `concord`,
`generic/capsule` — which gives a second, cheaper heuristic once the hash pass
has confirmed it.

## Repeating it

Both indexes are in the tools cache at
`targets/<target>/builds/<build>/indexes/resfileindex.txt`. Load each as a
`path -> md5` map, lower-case the paths, and classify every Frontier path as
copied, differing or absent. The whole pass is a few seconds over two text
files and needs no network.

Note the builds compared here were not contemporaneous (Frontier 3474408, EVE
3503375). That does not weaken the conclusion — a copy stays byte-identical
across EVE builds only if the file did not change, so build skew can only ever
UNDERCOUNT copies, never invent them.
