import {
  type CustomExtension,
  type GroupContextExtension,
  makeCustomExtension,
} from "ts-mls";
import { isValidRelayUrl } from "../utils/relay-url.js";
import {
  MARMOT_GROUP_DATA_EXTENSION_TYPE,
  MARMOT_GROUP_DATA_VERSION,
  MarmotGroupData,
} from "./protocol.js";

// Encoder/decoder for MarmotGroupData
// Format: [version: u8, nostrGroupId: [u8; 32], name: utf8str, description: utf8str, adminPubkeys: [utf8str], relays: [utf8str]]

const encodeUtf8 = (str: string): Uint8Array => new TextEncoder().encode(str);
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes);

// Variable-length integer encoding (similar to Protocol Buffers varint)
// For simplicity, we use a fixed 4-byte length prefix for byte arrays
function encodeBytes(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;
  const result = new Uint8Array(4 + length);
  const view = new DataView(result.buffer);
  view.setUint32(0, length, false); // big-endian
  result.set(bytes, 4);
  return result;
}

function decodeBytes(
  data: Uint8Array,
  offset: number,
): [Uint8Array, number] | undefined {
  if (offset + 4 > data.length) return undefined;
  const view = new DataView(data.buffer, data.byteOffset);
  const length = view.getUint32(offset, false); // big-endian
  if (offset + 4 + length > data.length) return undefined;
  return [data.slice(offset + 4, offset + 4 + length), offset + 4 + length];
}

function assertFixedOrNull(
  field: string,
  value: Uint8Array | null,
  expectedLen: number,
): void {
  if (value === null) return;
  if (value.length !== expectedLen)
    throw new Error(`${field} must be null or exactly ${expectedLen} bytes`);
}

function encodeOptionalFixed(value: Uint8Array | null): Uint8Array {
  // Encode as length-prefixed bytes; null is represented as 0-length.
  return encodeBytes(value ?? new Uint8Array());
}

function decodeOptionalFixed(
  data: Uint8Array,
  offset: number,
  expectedLen: number,
): [Uint8Array | null, number] | undefined {
  const res = decodeBytes(data, offset);
  if (!res) return undefined;
  const [bytes, next] = res;
  if (bytes.length === 0) return [null, next];
  if (bytes.length !== expectedLen) return undefined;
  return [bytes, next];
}

function isHexKey(str: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(str);
}

function encodeStringArray(strings: string[]): Uint8Array {
  const encodedStrings = strings.map((s) => encodeBytes(encodeUtf8(s)));
  const totalLength = encodedStrings.reduce(
    (sum, bytes) => sum + bytes.length,
    0,
  );
  const result = new Uint8Array(4 + totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, strings.length, false); // big-endian
  let offset = 4;
  for (const bytes of encodedStrings) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

function decodeStringArray(
  data: Uint8Array,
  offset: number,
): [string[], number] | undefined {
  if (offset + 4 > data.length) return undefined;
  const view = new DataView(data.buffer, data.byteOffset);
  const count = view.getUint32(offset, false); // big-endian
  const strings: string[] = [];
  let currentOffset = offset + 4;
  for (let i = 0; i < count; i++) {
    const result = decodeBytes(data, currentOffset);
    if (!result) return undefined;
    const [bytes, newOffset] = result;
    strings.push(decodeUtf8(bytes));
    currentOffset = newOffset;
  }
  return [strings, currentOffset];
}

/**
 * Encodes MarmotGroupData to bytes.
 *
 * @param data - The MarmotGroupData to encode
 * @returns Encoded bytes
 */
export function encodeMarmotGroupData(data: MarmotGroupData): Uint8Array {
  if (data.nostrGroupId.length !== 32)
    throw new Error("nostr_group_id must be exactly 32 bytes");
  for (const pk of data.adminPubkeys) {
    if (!isHexKey(pk)) throw new Error("Invalid admin public key format");
  }
  for (const relay of data.relays) {
    if (!isValidRelayUrl(relay)) throw new Error("Invalid relay URL");
  }
  assertFixedOrNull("image_hash", data.imageHash, 32);
  assertFixedOrNull("image_key", data.imageKey, 32);
  assertFixedOrNull("image_nonce", data.imageNonce, 12);

  const version = new Uint8Array([data.version]);
  const nostrGroupId = encodeBytes(data.nostrGroupId);
  const name = encodeBytes(encodeUtf8(data.name));
  const description = encodeBytes(encodeUtf8(data.description));
  const adminPubkeys = encodeStringArray(data.adminPubkeys);
  // Keep relays as given (tests assert exact string equality).
  // Validation still ensures they are valid websocket URLs.
  const relays = encodeStringArray(data.relays);

  const imageHash = encodeOptionalFixed(data.imageHash);
  const imageKey = encodeOptionalFixed(data.imageKey);
  const imageNonce = encodeOptionalFixed(data.imageNonce);

  const totalLength =
    version.length +
    nostrGroupId.length +
    name.length +
    description.length +
    adminPubkeys.length +
    relays.length +
    imageHash.length +
    imageKey.length +
    imageNonce.length;

  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(version, offset);
  offset += version.length;
  result.set(nostrGroupId, offset);
  offset += nostrGroupId.length;
  result.set(name, offset);
  offset += name.length;
  result.set(description, offset);
  offset += description.length;
  result.set(adminPubkeys, offset);
  offset += adminPubkeys.length;
  result.set(relays, offset);
  offset += relays.length;
  result.set(imageHash, offset);
  offset += imageHash.length;
  result.set(imageKey, offset);
  offset += imageKey.length;
  result.set(imageNonce, offset);

  return result;
}

/**
 * Decodes MarmotGroupData from bytes.
 *
 * @param data - The bytes to decode
 * @returns Decoded MarmotGroupData
 * @throws Error if decoding fails
 */
export function decodeMarmotGroupData(data: Uint8Array): MarmotGroupData {
  if (data.length < 1) throw new Error("Extension data too short");

  const version = data[0];
  if (version !== MARMOT_GROUP_DATA_VERSION) {
    throw new Error(
      `Unsupported MarmotGroupData version: ${version}, expected ${MARMOT_GROUP_DATA_VERSION}`,
    );
  }

  let offset = 1;

  const nostrGroupIdResult = decodeBytes(data, offset);
  if (!nostrGroupIdResult) throw new Error("Extension data too short");
  const [nostrGroupId, nostrGroupIdOffset] = nostrGroupIdResult;
  if (nostrGroupId.length !== 32) {
    throw new Error(
      `Invalid nostrGroupId length: ${nostrGroupId.length}, expected 32`,
    );
  }
  offset = nostrGroupIdOffset;

  const nameResult = decodeBytes(data, offset);
  if (!nameResult) throw new Error("Extension data too short");
  const [nameBytes, nameOffset] = nameResult;
  const name = decodeUtf8(nameBytes);
  offset = nameOffset;

  const descriptionResult = decodeBytes(data, offset);
  if (!descriptionResult) throw new Error("Extension data too short");
  const [descriptionBytes, descriptionOffset] = descriptionResult;
  const description = decodeUtf8(descriptionBytes);
  offset = descriptionOffset;

  const adminPubkeysResult = decodeStringArray(data, offset);
  if (!adminPubkeysResult) throw new Error("Extension data too short");
  const [adminPubkeys, adminPubkeysOffset] = adminPubkeysResult;
  offset = adminPubkeysOffset;

  const relaysResult = decodeStringArray(data, offset);
  if (!relaysResult) throw new Error("Extension data too short");
  const [relays, relaysOffset] = relaysResult;
  offset = relaysOffset;

  const imageHashRes = decodeOptionalFixed(data, offset, 32);
  if (!imageHashRes) throw new Error("Extension data too short");
  const [imageHash, imageHashOffset] = imageHashRes;
  offset = imageHashOffset;

  const imageKeyRes = decodeOptionalFixed(data, offset, 32);
  if (!imageKeyRes) throw new Error("Extension data too short");
  const [imageKey, imageKeyOffset] = imageKeyRes;
  offset = imageKeyOffset;

  const imageNonceRes = decodeOptionalFixed(data, offset, 12);
  if (!imageNonceRes) throw new Error("Extension data too short");
  const [imageNonce] = imageNonceRes;

  return {
    version,
    nostrGroupId,
    name,
    description,
    adminPubkeys,
    relays,
    imageHash,
    imageKey,
    imageNonce,
  };
}

export type CreateMarmotGroupDataOptions = Partial<
  Omit<MarmotGroupData, "version">
>;

/** Creates a valid MarmotGroupData byte payload (MIP-01). */
export function createMarmotGroupData(
  opts: CreateMarmotGroupDataOptions = {},
): Uint8Array {
  const data: MarmotGroupData = {
    version: MARMOT_GROUP_DATA_VERSION,
    nostrGroupId: opts.nostrGroupId ?? new Uint8Array(32),
    name: opts.name ?? "",
    description: opts.description ?? "",
    adminPubkeys: opts.adminPubkeys ?? [],
    relays: opts.relays ?? [],
    imageHash: opts.imageHash ?? null,
    imageKey: opts.imageKey ?? null,
    imageNonce: opts.imageNonce ?? null,
  };
  return encodeMarmotGroupData(data);
}

/** Returns true if pubkey is included in adminPubkeys (case-insensitive). */
export function isAdmin(groupData: MarmotGroupData, pubkey: string): boolean {
  const pk = pubkey.toLowerCase();
  return groupData.adminPubkeys.some((a) => a.toLowerCase() === pk);
}

/**
 * Converts MarmotGroupData to an Extension object for use in MLS groups.
 *
 * @param data - The Marmot group data to convert
 * @returns Extension object with Marmot Group Data Extension type and encoded data
 */
export function marmotGroupDataToExtension(
  data: MarmotGroupData,
): GroupContextExtension {
  return makeCustomExtension({
    extensionType: MARMOT_GROUP_DATA_EXTENSION_TYPE,
    extensionData: encodeMarmotGroupData(data),
  });
}

/** Type guard for the Marmot Group Data custom extension (0xf2ee). */
export function isMarmotGroupDataExtension(
  ext: GroupContextExtension,
): ext is CustomExtension {
  return (
    typeof ext.extensionType === "number" &&
    ext.extensionType === MARMOT_GROUP_DATA_EXTENSION_TYPE &&
    ext.extensionData instanceof Uint8Array
  );
}

/** Extracts and validates the Marmot Group Data extension payload bytes. */
export function getMarmotGroupDataExtensionBytes(
  ext: GroupContextExtension,
): Uint8Array {
  if (!isMarmotGroupDataExtension(ext)) {
    throw new Error("Not a MarmotGroupData extension");
  }
  return ext.extensionData;
}
