// Lazy-load `browser-image-compression` (~50 KB parsed). The module is only
// needed when a user uploads a photo, so this defers loading off the
// initial bundle and into the upload click path.
//
// Pick `maxSizeMB` based on the surface: avatars use 0.2, squawk/note
// photos use 1 (better detail for mechanic review).
type CompressOptions = {
  maxSizeMB: number;
  maxWidthOrHeight: number;
  useWebWorker?: boolean;
};

export async function compressImage(file: File, options: CompressOptions): Promise<File> {
  const mod = await import('browser-image-compression');
  return mod.default(file, options);
}
