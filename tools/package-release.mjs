import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = resolve(ROOT, 'platform/chromium');
const RELEASE = resolve(ROOT, 'dist/release');
const ZIP = resolve(RELEASE, 'uBlock-Ultimate-0.2.0-chromium.zip');
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01, the earliest ZIP timestamp.

if (!existsSync(resolve(EXTENSION, 'manifest.json'))) {
    throw new Error('Missing production build; run npm run build first');
}

function listFiles(root) {
    const files = [];
    const visit = directory => {
        for (const name of readdirSync(directory).sort()) {
            const absolute = resolve(directory, name);
            if (statSync(absolute).isDirectory()) visit(absolute);
            else files.push(absolute);
        }
    };
    visit(root);
    return files.sort((a, b) =>
        relative(root, a).localeCompare(relative(root, b), 'en')
    );
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0
            ? 0xEDB88320 ^ (value >>> 1)
            : value >>> 1;
    }
    crcTable[index] = value >>> 0;
}

function crc32(content) {
    let value = 0xFFFFFFFF;
    for (const byte of content) {
        value = crcTable[(value ^ byte) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
}

function localHeader(entry) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034B50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(DEFLATE_METHOD, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);
    return header;
}

function centralHeader(entry) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014B50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(DEFLATE_METHOD, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed.length, 20);
    header.writeUInt32LE(entry.content.length, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    return header;
}

const entries = listFiles(EXTENSION).map(path => {
    const content = readFileSync(path);
    const name = Buffer.from(
        relative(EXTENSION, path).replaceAll('\\', '/'),
        'utf8',
    );
    return {
        name,
        content,
        compressed: deflateRawSync(content, { level: 9 }),
        crc: crc32(content),
        offset: 0,
    };
});

const localParts = [];
let offset = 0;
for (const entry of entries) {
    entry.offset = offset;
    const header = localHeader(entry);
    localParts.push(header, entry.name, entry.compressed);
    offset += header.length + entry.name.length + entry.compressed.length;
}

const centralParts = [];
for (const entry of entries) {
    centralParts.push(centralHeader(entry), entry.name);
}
const centralDirectory = Buffer.concat(centralParts);

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054B50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

mkdirSync(RELEASE, { recursive: true });
writeFileSync(ZIP, Buffer.concat([...localParts, centralDirectory, end]));

const content = readFileSync(ZIP);
const sha256 = createHash('sha256').update(content).digest('hex');
console.log(`Package: ${ZIP}`);
console.log(`Size: ${(statSync(ZIP).size / 1024 / 1024).toFixed(2)} MiB`);
console.log(`SHA-256: ${sha256}`);
