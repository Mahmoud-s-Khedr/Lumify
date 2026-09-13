export function publicFile(file: {
  id: bigint;
  originalName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
}) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes?.toString() ?? null,
    downloadUrl: `/files/${file.id.toString()}/download`,
  };
}
