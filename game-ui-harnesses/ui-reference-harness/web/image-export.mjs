import { createStoredZip } from "../../ui-panel-harness/src/zip-store.mjs";
import { validateDelivery } from "../src/output.mjs";
import { panelDisplayTitle } from "./examples/panel-names.mjs";
import {
  local,
  readBytes,
  readJson,
  requireThat,
  sha256,
} from "../src/common.mjs";

function filenameStem(title, fallback) {
  let name = String(title || fallback)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/gu, "_")
    .replace(/[. ]+$/u, "")
    .trim();
  if (!name || /^\.+$/u.test(name)) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name))
    name = `_${name}`;
  // Leave space for a collision suffix and the extension on common filesystems.
  while (Buffer.byteLength(name) > 180)
    name = Array.from(name).slice(0, -1).join("");
  return name;
}

export function projectExportFilename(projectName, format) {
  requireThat(["images", "complete"].includes(format), "EXPORT_FORMAT_INVALID");
  const prefix = filenameStem(projectName, "project");
  return `${prefix}-${format === "images" ? "reference-images" : "references"}.zip`;
}

/** HTTP headers must stay ASCII; filename* carries the actual UTF-8 name. */
export function attachmentDisposition(filename) {
  const name = String(filename).toWellFormed();
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Keep the public writer's payloads/CRCs and deterministic metadata. Only rename
 * its safe ASCII entries and set ZIP's UTF-8 flag for user-facing panel titles. */
export function namedImageZip(images) {
  const used = new Set(),
    names = new Map(),
    files = new Map();
  for (const [index, image] of images.entries()) {
    const base = filenameStem(
      String(panelDisplayTitle(image) || image.panelId).replace(/\.png$/iu, ""),
      image.panelId,
    );
    let name = `${base}.png`,
      suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${suffix++}).png`;
    used.add(name.toLowerCase());
    const key = `image-${String(index).padStart(4, "0")}.png`;
    names.set(key, Buffer.from(name));
    files.set(key, image.bytes);
  }
  const source = Buffer.from(createStoredZip(files));
  const end = Buffer.from(source.subarray(-22));
  const localParts = [],
    centralParts = [];
  let central = end.readUInt32LE(16),
    offset = 0;
  for (let index = 0; index < images.length; index++) {
    const header = Buffer.from(source.subarray(central, central + 46));
    const oldLength = header.readUInt16LE(28);
    const key = source.toString(
      "ascii",
      central + 46,
      central + 46 + oldLength,
    );
    const name = names.get(key),
      originalOffset = header.readUInt32LE(42);
    const localHeader = Buffer.from(
      source.subarray(originalOffset, originalOffset + 30),
    );
    const payloadStart = originalOffset + 30 + localHeader.readUInt16LE(26);
    const payload = source.subarray(
      payloadStart,
      payloadStart + header.readUInt32LE(20),
    );
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    localParts.push(localHeader, name, payload);
    centralParts.push(header, name);
    offset += localHeader.length + name.length + payload.length;
    central += 46 + oldLength;
  }
  const centralBytes = Buffer.concat(centralParts);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  requireThat(
    offset + centralBytes.length + end.length <= 64 * 1024 * 1024,
    "ZIP_SIZE_LIMIT",
  );
  return Buffer.concat([...localParts, centralBytes, end]);
}

/** A convenience view derived only from a fully verified core delivery. */
export function createImageExport(output) {
  validateDelivery(output);
  const manifest = readJson(local(output, "manifest.json"));
  const artifact = (name) => {
    const record = manifest.files.find((item) => item.path === name);
    const bytes = readBytes(local(output, name));
    requireThat(
      record &&
        bytes.length === record.bytes &&
        sha256(bytes) === record.sha256,
      "DELIVERY_CHECKSUM",
    );
    return bytes;
  };
  return namedImageZip(
    manifest.panelIds.map((panelId) => {
      const prefix = `panels/${panelId}`;
      const prototype = JSON.parse(artifact(`${prefix}/prototype.json`));
      return {
        panelId,
        title: prototype.title,
        bytes: artifact(`${prefix}/reference.png`),
      };
    }),
  );
}
