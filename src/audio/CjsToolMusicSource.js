import fs from "node:fs/promises";
import path from "node:path";

import {
    installMusicLibrary,
} from "@carbonenginejs/runtime-audio/library";

const AUDIO_MEDIA_TYPES = Object.freeze({
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
});

/**
 * Lists and reads explicitly cataloged neutral music tracks from one local directory.
 *
 * Only catalog songs are addressable; arbitrary paths are never accepted.
 */
export class CjsToolMusicSource
{
    #directory;

    #selections = new WeakMap();

    /**
     * Creates a source over one caller-owned catalog and local music root.
     *
     * @param {object} options Source options.
     * @param {object} options.library Runtime-audio music-library document.
     * @param {string} options.directory Local music root.
     */
    constructor({ library, directory } = {})
    {
        if (typeof directory !== "string" || !directory.trim())
        {
            throw new TypeError(
                "CjsToolMusicSource directory must be a non-empty path",
            );
        }

        this.library = installMusicLibrary(library);
        this.#directory = path.resolve(directory);
        Object.freeze(this);
    }

    /**
     * Returns library identity and small playlist summaries with service URLs.
     */
    async ListPlaylists({ urlForPlaylist } = {})
    {
        RequireUrlFactory(urlForPlaylist, "urlForPlaylist");
        const playlists = await Promise.all(this.library.playlists.map(
            async playlist =>
            {
                const songs = await this.#DescribeSongs(playlist);

                return Object.freeze({
                    id: playlist.id,
                    name: playlist.name,
                    author: playlist.author ?? this.library.author ?? "",
                    version: playlist.version ?? this.library.version,
                    songCount: playlist.songs.length,
                    availableSongCount: songs.filter(
                        song => song.available,
                    ).length,
                    url: urlForPlaylist(playlist.id),
                });
            },
        ));

        return Object.freeze({
            schema: "carbonenginejs.musicService",
            schemaVersion: 1,
            name: this.library.name,
            author: this.library.author ?? "",
            version: this.library.version,
            playlists: Object.freeze(playlists),
        });
    }

    /** Returns one playlist with per-song availability and service URLs. */
    async GetPlaylist(playlistID, { urlForSong } = {})
    {
        RequireUrlFactory(urlForSong, "urlForSong");
        const playlist = this.#FindPlaylist(playlistID);
        const songs = await this.#DescribeSongs(playlist);

        return Object.freeze({
            id: playlist.id,
            name: playlist.name,
            author: playlist.author ?? this.library.author ?? "",
            version: playlist.version ?? this.library.version,
            songs: Object.freeze(songs.map(song => Object.freeze({
                ...song,
                url: urlForSong(playlist.id, song.id),
            }))),
        });
    }

    /**
     * Returns an installable runtime-audio music library whose song URLs point
     * at this service. Unavailable songs are omitted by default.
     */
    async GetLibrary({
        urlForSong,
        includeUnavailable = false,
    } = {})
    {
        RequireUrlFactory(urlForSong, "urlForSong");
        const playlists = [];

        for (const playlist of this.library.playlists)
        {
            const songs = (await this.#DescribeSongs(playlist))
                .filter(song => includeUnavailable || song.available)
                .map(song =>
                {
                    const { available, mediaType, byteLength, ...metadata } =
                        song;

                    return Object.freeze({
                        ...metadata,
                        ...(includeUnavailable ? { available } : {}),
                        url: urlForSong(playlist.id, song.id),
                    });
                });

            if (songs.length)
            {
                playlists.push(Object.freeze({
                    id: playlist.id,
                    name: playlist.name,
                    author: playlist.author ?? this.library.author ?? "",
                    version: playlist.version ?? this.library.version,
                    songs: Object.freeze(songs),
                }));
            }
        }

        if (!playlists.length)
        {
            throw CreateStatusError(
                "Music library has no available songs",
                404,
            );
        }

        return Object.freeze({
            schema: "carbonenginejs.musicLibrary",
            schemaVersion: 1,
            name: this.library.name,
            author: this.library.author ?? "",
            version: this.library.version,
            playlists: Object.freeze(playlists),
        });
    }

    /**
     * Resolves one catalog song to a local immutable selection.
     *
     * A missing catalog member or local file is reported as 404 so HEAD is the
     * availability contract used by browser playlists.
     */
    async ResolveSong(playlistID, songID)
    {
        const playlist = this.#FindPlaylist(playlistID);
        const song = playlist.songs.find(
            item => item.id === String(songID),
        );

        if (!song)
        {
            throw CreateStatusError(
                `Music-library song not found: ${songID}`,
                404,
            );
        }

        const descriptor = await this.#ResolveDescriptor(playlist, song);

        if (!descriptor)
        {
            throw CreateStatusError(
                `Music-library song is unavailable: ${song.id}`,
                404,
            );
        }

        const selection = Object.freeze({
            playlistID: playlist.id,
            songID: song.id,
            name: song.name,
            mediaType: descriptor.mediaType,
            totalByteLength: descriptor.byteLength,
            acceptRanges: true,
            etag: descriptor.etag,
        });

        this.#selections.set(selection, descriptor);
        return selection;
    }

    /** Reads one complete or ranged song selection as detached bytes. */
    async ReadSong(selection, { offset = 0, byteLength = null } = {})
    {
        const descriptor = this.#selections.get(selection);

        if (!descriptor)
        {
            throw new TypeError(
                "CjsToolMusicSource requires one of its song selections",
            );
        }

        const source = await fs.readFile(descriptor.filePath);
        const range = NormalizeRange(
            offset,
            byteLength,
            source.byteLength,
        );
        const bytes = source.subarray(
            range.offset,
            range.offset + range.byteLength,
        );

        return Object.freeze({
            bytes: bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ),
            byteLength: bytes.byteLength,
            totalByteLength: source.byteLength,
        });
    }

    /** Describes every catalog song with its current local availability. */
    async #DescribeSongs(playlist)
    {
        return Promise.all(playlist.songs.map(async song =>
        {
            const descriptor = await this.#ResolveDescriptor(playlist, song);
            const { path: _path, url: _url, ...metadata } = song;

            return Object.freeze({
                ...metadata,
                available: descriptor !== null,
                mediaType: descriptor?.mediaType ?? null,
                byteLength: descriptor?.byteLength ?? null,
            });
        }));
    }

    /** Finds one installed playlist or reports a public not-found error. */
    #FindPlaylist(playlistID)
    {
        const id = String(playlistID);
        const playlist = this.library.playlists.find(
            item => item.id === id,
        );

        if (!playlist)
        {
            throw CreateStatusError(
                `Music-library playlist not found: ${id}`,
                404,
            );
        }
        return playlist;
    }

    /** Resolves one song to a canonical file contained by the music root. */
    async #ResolveDescriptor(playlist, song)
    {
        const root = await RealPath(this.#directory);

        if (!root)
        {
            return null;
        }

        const explicit = ResolveExplicitPath(this.#directory, song.path);
        let filePath = explicit
            ? await ResolveContainedFile(root, explicit)
            : null;

        if (!filePath)
        {
            const playlistDirectory = path.resolve(
                this.#directory,
                playlist.id,
            );

            if (!IsWithin(this.#directory, playlistDirectory))
            {
                return null;
            }

            const resolvedPlaylistDirectory =
                await RealPath(playlistDirectory);

            if (!resolvedPlaylistDirectory
                || !IsWithin(root, resolvedPlaylistDirectory))
            {
                return null;
            }

            let entries;

            try
            {
                entries = await fs.readdir(
                    resolvedPlaylistDirectory,
                    { withFileTypes: true },
                );
            }
            catch (error)
            {
                if (error?.code === "ENOENT")
                {
                    return null;
                }
                throw error;
            }

            const prefix = `${song.id}.`;
            const match = entries
                .filter(entry =>
                    entry.isFile()
                    && entry.name.startsWith(prefix)
                    && IsAudioPath(entry.name))
                .sort((left, right) =>
                    left.name.localeCompare(right.name, "en"))[0];

            filePath = match
                ? path.resolve(resolvedPlaylistDirectory, match.name)
                : null;
        }

        filePath = filePath
            ? await ResolveContainedFile(root, filePath)
            : null;

        if (!filePath)
        {
            return null;
        }

        const stat = await fs.stat(filePath);
        const mediaType = MediaTypeFromPath(filePath);

        return Object.freeze({
            filePath,
            mediaType,
            byteLength: stat.size,
            etag: `W/"music-${stat.size}-${Math.trunc(stat.mtimeMs)}"`,
        });
    }
}

function ResolveExplicitPath(root, value)
{
    if (typeof value !== "string"
        || !value
        || path.isAbsolute(value)
        || /^[a-z][a-z0-9+.-]*:/iu.test(value))
    {
        return null;
    }

    const filePath = path.resolve(root, value);

    return IsWithin(root, filePath) ? filePath : null;
}

async function IsFile(filePath)
{
    try
    {
        return (await fs.stat(filePath)).isFile();
    }
    catch (error)
    {
        if (error?.code === "ENOENT")
        {
            return false;
        }
        throw error;
    }
}

async function RealPath(filePath)
{
    try
    {
        return await fs.realpath(filePath);
    }
    catch (error)
    {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR")
        {
            return null;
        }
        throw error;
    }
}

async function ResolveContainedFile(root, filePath)
{
    const resolved = await RealPath(filePath);

    return resolved
        && IsWithin(root, resolved)
        && await IsFile(resolved)
        ? resolved
        : null;
}

function IsWithin(root, filePath)
{
    const relative = path.relative(root, filePath);

    return relative !== ""
        && relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative);
}

function MediaTypeFromPath(filePath)
{
    const extension = path.extname(filePath).toLowerCase();

    return AUDIO_MEDIA_TYPES[extension] ?? "application/octet-stream";
}

function IsAudioPath(filePath)
{
    const extension = path.extname(filePath).toLowerCase();

    return Object.hasOwn(AUDIO_MEDIA_TYPES, extension);
}

function NormalizeRange(offset, byteLength, totalByteLength)
{
    const start = Number(offset);
    const length = byteLength === null
        ? totalByteLength - start
        : Number(byteLength);

    if (!Number.isSafeInteger(start)
        || start < 0
        || !Number.isSafeInteger(length)
        || length < 0
        || start + length > totalByteLength)
    {
        throw new RangeError("Music-library byte range is outside the song");
    }
    return { offset: start, byteLength: length };
}

function RequireUrlFactory(value, label)
{
    if (typeof value !== "function")
    {
        throw new TypeError(`CjsToolMusicSource ${label} must be a function`);
    }
}

function CreateStatusError(message, statusCode)
{
    const error = new Error(message);

    error.statusCode = statusCode;
    return error;
}
