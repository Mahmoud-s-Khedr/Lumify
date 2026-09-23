import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';

export type StoredObject = { sizeBytes: bigint; mimeType?: string };

export interface ObjectStorage {
  createUploadUrl(key: string, mimeType: string): Promise<string>;
  createDownloadUrl(key: string): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  getBytes(key: string): Promise<Uint8Array>;
  putBytes(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class R2Storage implements ObjectStorage {
  private readonly client: S3Client;

  public constructor() {
    if (
      !env.R2_ACCOUNT_ID ||
      !env.R2_BUCKET_NAME ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY
    ) {
      throw new AppError(503, 'File storage is not configured.', 'FILE_STORAGE_UNAVAILABLE');
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  public async createUploadUrl(key: string, mimeType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, ContentType: mimeType }),
      { expiresIn: env.R2_PRESIGNED_URL_TTL_SECONDS },
    );
  }

  public async createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      { expiresIn: env.R2_PRESIGNED_URL_TTL_SECONDS },
    );
  }

  public async head(key: string): Promise<StoredObject | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      );
      return { sizeBytes: BigInt(object.ContentLength ?? 0), mimeType: object.ContentType };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'NotFound'
      )
        return null;
      throw error;
    }
  }

  public async getBytes(key: string): Promise<Uint8Array> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      );
      if (!object.Body) throw new AppError(404, 'Stored object was not found.', 'FILE_NOT_FOUND');
      return object.Body.transformToByteArray();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'NoSuchKey'
      )
        throw new AppError(404, 'Stored object was not found.', 'FILE_NOT_FOUND');
      throw error;
    }
  }

  public async putBytes(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
      }),
    );
  }

  public async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  }
}

class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject & { bytes?: Uint8Array }>();

  public async createUploadUrl(key: string, mimeType: string): Promise<string> {
    this.objects.set(key, { sizeBytes: 1n, mimeType });
    return `memory://upload/${key}`;
  }

  public async createDownloadUrl(key: string): Promise<string> {
    return `memory://download/${key}`;
  }

  public async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  public async getBytes(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new AppError(404, 'Stored object was not found.', 'FILE_NOT_FOUND');
    if (!object.bytes)
      throw new AppError(
        400,
        'The uploaded object has no readable content in this environment.',
        'INVALID_FILE',
      );
    return object.bytes;
  }

  public async putBytes(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    this.objects.set(key, { sizeBytes: BigInt(bytes.byteLength), mimeType, bytes });
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public setObject(key: string, object: StoredObject): void {
    this.objects.set(key, object);
  }
}

const memoryStorage = new MemoryStorage();
let r2Storage: R2Storage | undefined;

export function objectStorage(): ObjectStorage {
  if (env.NODE_ENV === 'test') return memoryStorage;
  r2Storage ??= new R2Storage();
  return r2Storage;
}

export function setTestObject(key: string, object: StoredObject & { bytes?: Uint8Array }): void {
  memoryStorage.setObject(key, object);
}
