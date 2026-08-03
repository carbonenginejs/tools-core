import test from "node:test";
import assert from "node:assert/strict";

import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";
import { CjsToolCharacterCatalogGatherer } from "../src/character/CjsToolCharacterCatalogGatherer.js";

const baseConfiguration = "res:/example/base.configuration";
const baseGeometry = "res:/example/base.geometry";
const versionGeometry = "res:/example/version.geometry";
const clearedTexture = "res:/example/cleared.texture";

test("materializes sparse part-source overlays without mutating authoring input", async () =>
{
    const partSources = {
        "female/example": {
            sourcePath: "res:/example",
            sex: "female",
            partPath: "example",
            metadata: "metadata/source",
            versions: [ {
                resourceVersion: null,
                metadata: "metadata/baseline",
                configurationCandidates: [ baseConfiguration ],
                geometryCandidates: [ baseGeometry ],
                textureCandidates: []
            }, {
                resourceVersion: "v1",
                metadata: "metadata/v1",
                geometryCandidates: [ versionGeometry ]
            }, {
                resourceVersion: "v2",
                metadata: null,
                configurationCandidates: [],
                textureCandidates: [ clearedTexture ]
            }, {
                resourceVersion: "v3"
            } ]
        }
    };
    const before = structuredClone(partSources);
    const index = CreateIndex([
        baseConfiguration,
        baseGeometry,
        versionGeometry,
        clearedTexture
    ]);
    const { documents, report } = await new CjsToolCharacterCatalogGatherer().Gather(
        index,
        { partSources }
    );
    const versions = documents.characterPartSources["female/example"].versions;

    assert.deepEqual(partSources, before);
    assert.deepEqual(versions, [ {
        resourceVersion: null,
        configurationCandidates: [ baseConfiguration ],
        geometryCandidates: [ baseGeometry ],
        textureCandidates: [],
        metadata: "metadata/baseline"
    }, {
        resourceVersion: "v1",
        metadata: "metadata/v1",
        geometryCandidates: [ versionGeometry ],
        configurationCandidates: [ baseConfiguration ],
        textureCandidates: []
    }, {
        resourceVersion: "v2",
        metadata: null,
        configurationCandidates: [],
        textureCandidates: [ clearedTexture ],
        geometryCandidates: [ baseGeometry ]
    }, {
        resourceVersion: "v3",
        metadata: "metadata/baseline",
        configurationCandidates: [ baseConfiguration ],
        geometryCandidates: [ baseGeometry ],
        textureCandidates: []
    } ]);
    assert.deepEqual(report.candidateResources, {
        partSources: 1,
        configuration: 3,
        geometry: 4,
        texture: 1
    });
});

test("rejects duplicate resource-version authoring records", async () =>
{
    const index = CreateIndex([]);

    await assert.rejects(
        () => new CjsToolCharacterCatalogGatherer().Gather(index, {
            partSources: {
                "female/example": {
                    versions: [ {
                        resourceVersion: "v1"
                    }, {
                        resourceVersion: "v1"
                    } ]
                }
            }
        }),
        error =>
        {
            assert.equal(error.report.errors.length, 1);
            assert.match(error.report.errors[0].message, /duplicate resource version/u);
            return true;
        }
    );
});

function CreateIndex(paths)
{
    return CjsFileIndex.parseResFileIndex(paths.map((logicalPath, index) =>
        `${logicalPath},a${index}/resource,,,,`
    ).join("\n"));
}
