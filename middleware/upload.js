import multer from 'multer'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

const IMAGE_MAX_BYTES = 5  * 1024 * 1024   // 5MB
const VIDEO_MAX_BYTES = 30 * 1024 * 1024   // 30MB — generous ceiling; the real
                                            // limit that matters is the 20s
                                            // duration cap enforced after
                                            // upload (see cloudinaryUpload.service.js)

const storage = multer.memoryStorage()

function fileFilter(allowedTypes) {
  return (_req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true)
    cb(new Error(`Unsupported file type: ${file.mimetype}`))
  }
}

/** Single image upload — field name "image". Used by Equipment. */
export const uploadImage = multer({
  storage,
  limits:     { fileSize: IMAGE_MAX_BYTES },
  fileFilter: fileFilter(IMAGE_TYPES),
}).single('image')

/**
 * Optional image AND/OR optional video in the same request — field names
 * "image" and "video". Used by the Workout Library, where a workout can
 * have a thumbnail image, a demo video, both, or neither.
 */
export const uploadWorkoutMedia = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_BYTES },   // multer applies one limit across fields; video is the larger cap
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image') return fileFilter(IMAGE_TYPES)(req, file, cb)
    if (file.fieldname === 'video') return fileFilter(VIDEO_TYPES)(req, file, cb)
    cb(new Error(`Unexpected field: ${file.fieldname}`))
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
])

/**
 * Wraps a multer middleware so its errors come back as normal JSON API
 * errors instead of multer's default stack-trace-y error shape.
 */
export function handleUploadErrors(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next()
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'File is too large.' })
        }
        return res.status(400).json({ message: `Upload error: ${err.message}` })
      }
      return res.status(400).json({ message: err.message || 'Upload failed' })
    })
  }
}
