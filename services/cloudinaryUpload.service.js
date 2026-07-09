import cloudinary from '../config/cloudinary.js'

/**
 * Uploads an in-memory image buffer (from multer) to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {string}  folder   e.g. 'fitos/equipment'
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export function uploadImageBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => {
        if (err) return reject(new Error(err.message || 'Image upload failed'))
        resolve({ url: result.secure_url, publicId: result.public_id })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Uploads an in-memory video buffer to Cloudinary and enforces a maximum
 * duration.
 *
 * Cloudinary inspects the video's real metadata (including exact duration
 * in seconds) as part of the upload response — there is no reliable way to
 * know a video's duration from the raw bytes without decoding it, so we let
 * Cloudinary do that work rather than shipping ffmpeg/ffprobe on the server.
 * If the uploaded video exceeds the limit, we immediately delete it from
 * Cloudinary (no orphaned assets left behind) and reject.
 *
 * @param {Buffer} buffer
 * @param {string}  folder            e.g. 'fitos/workouts'
 * @param {number}  maxDurationSec    hard cap, e.g. 20
 * @returns {Promise<{ url: string, publicId: string, duration: number }>}
 */
export function uploadVideoBuffer(buffer, folder, maxDurationSec = 20) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'video' },
      async (err, result) => {
        if (err) return reject(new Error(err.message || 'Video upload failed'))

        const duration = result.duration || 0
        if (duration > maxDurationSec) {
          // Clean up — don't leave an oversized video sitting in Cloudinary
          try {
            await cloudinary.uploader.destroy(result.public_id, { resource_type: 'video' })
          } catch { /* best-effort cleanup */ }
          return reject(new Error(
            `Video is ${duration.toFixed(1)}s long — the maximum allowed is ${maxDurationSec}s.`
          ))
        }

        resolve({ url: result.secure_url, publicId: result.public_id, duration })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Deletes a previously-uploaded asset (used when replacing or removing
 * an equipment photo / workout image / workout video).
 */
export async function deleteAsset(publicId, resourceType = 'image') {
  if (!publicId) return
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
  } catch (err) {
    console.error(`[cloudinary] Failed to delete ${resourceType} ${publicId}:`, err.message)
  }
}
