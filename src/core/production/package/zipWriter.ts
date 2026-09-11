/**
 * Prexyon Agent — Zero-Dependency PKZIP Writer (Etapa 6.7)
 *
 * Gera arquivos ZIP válidos no padrão PKZIP 2.0 (modo Store) sem dependências externas.
 * Compatível tanto com Node.js/Vitest quanto com navegadores (Uint8Array / Blob).
 */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array | string | ArrayBuffer;
  lastModified?: Date;
}

/**
 * Converte data JS para formato DOS date/time (16 bits cada).
 */
function toDosDateTime(date: Date = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f));
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export class SimpleZipBuilder {
  private files: {
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    dosTime: number;
    dosDate: number;
  }[] = [];

  private encoder = new TextEncoder();

  /**
   * Adiciona um arquivo ao arquivo ZIP.
   */
  public addFile(name: string, content: Uint8Array | string | ArrayBuffer, date?: Date): this {
    const cleanName = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = this.encoder.encode(cleanName);

    let dataBytes: Uint8Array;
    if (typeof content === 'string') {
      dataBytes = this.encoder.encode(content);
    } else if (content instanceof Uint8Array) {
      dataBytes = content;
    } else if (content instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(content);
    } else {
      dataBytes = new Uint8Array(0);
    }

    const crc = computeCrc32(dataBytes);
    const { dosTime, dosDate } = toDosDateTime(date);

    this.files.push({
      nameBytes,
      dataBytes,
      crc,
      dosTime,
      dosDate,
    });

    return this;
  }

  /**
   * Constrói e retorna o buffer binário Uint8Array do arquivo ZIP completo.
   */
  public buildUint8Array(): Uint8Array {
    let localHeadersSize = 0;
    for (const f of this.files) {
      // 30 bytes fixos + nameBytes.length + dataBytes.length
      localHeadersSize += 30 + f.nameBytes.length + f.dataBytes.length;
    }

    let centralDirSize = 0;
    for (const f of this.files) {
      // 46 bytes fixos + nameBytes.length
      centralDirSize += 46 + f.nameBytes.length;
    }

    const eocdSize = 22;
    const totalSize = localHeadersSize + centralDirSize + eocdSize;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let offset = 0;
    const localOffsets: number[] = [];

    // 1. Gravar Local File Headers + File Data
    for (const f of this.files) {
      localOffsets.push(offset);

      // Assinatura Local File Header: 0x04034b50 (Little Endian)
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true); // Versão mínima (2.0)
      view.setUint16(offset + 6, 0x0800, true); // UTF-8 filename flag (bit 11)
      view.setUint16(offset + 8, 0, true); // Compressão: Store (0)
      view.setUint16(offset + 10, f.dosTime, true);
      view.setUint16(offset + 12, f.dosDate, true);
      view.setUint32(offset + 14, f.crc, true);
      view.setUint32(offset + 18, f.dataBytes.length, true); // Comp size
      view.setUint32(offset + 22, f.dataBytes.length, true); // Uncomp size
      view.setUint16(offset + 26, f.nameBytes.length, true);
      view.setUint16(offset + 28, 0, true); // Extra field length

      offset += 30;
      buffer.set(f.nameBytes, offset);
      offset += f.nameBytes.length;

      buffer.set(f.dataBytes, offset);
      offset += f.dataBytes.length;
    }

    const centralDirOffset = offset;

    // 2. Gravar Central Directory Headers
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i];
      const localOffset = localOffsets[i];

      // Assinatura Central Dir: 0x02014b50
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true); // Versão feita por (2.0)
      view.setUint16(offset + 6, 20, true); // Versão mínima
      view.setUint16(offset + 8, 0x0800, true); // UTF-8 flag
      view.setUint16(offset + 10, 0, true); // Store
      view.setUint16(offset + 12, f.dosTime, true);
      view.setUint16(offset + 14, f.dosDate, true);
      view.setUint32(offset + 16, f.crc, true);
      view.setUint32(offset + 20, f.dataBytes.length, true);
      view.setUint32(offset + 24, f.dataBytes.length, true);
      view.setUint16(offset + 28, f.nameBytes.length, true);
      view.setUint16(offset + 30, 0, true); // Extra field length
      view.setUint16(offset + 32, 0, true); // Comment length
      view.setUint16(offset + 34, 0, true); // Disk number start
      view.setUint16(offset + 36, 0, true); // Internal attributes
      view.setUint32(offset + 38, 0, true); // External attributes
      view.setUint32(offset + 42, localOffset, true); // Local header offset

      offset += 46;
      buffer.set(f.nameBytes, offset);
      offset += f.nameBytes.length;
    }

    // 3. Gravar End of Central Directory (EOCD)
    // Assinatura EOCD: 0x06054b50
    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 4, 0, true); // Disk #
    view.setUint16(offset + 6, 0, true); // Start disk #
    view.setUint16(offset + 8, this.files.length, true); // Entries on disk
    view.setUint16(offset + 10, this.files.length, true); // Total entries
    view.setUint32(offset + 12, centralDirSize, true); // Size of central dir
    view.setUint32(offset + 16, centralDirOffset, true); // Offset of central dir
    view.setUint16(offset + 20, 0, true); // Comment length

    return buffer;
  }

  /**
   * Constrói e retorna um Blob do tipo application/zip.
   */
  public buildBlob(): Blob {
    const bytes = this.buildUint8Array();
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
  }
}
