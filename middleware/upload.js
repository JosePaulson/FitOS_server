import multer from 'multer'
import { devOr, withUserMessage } from '../utils/errors.js'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
]

const IMAGE_MAX_BYTES = 5  * 1024 * 1024   // 5MB
const VIDEO_MAX_BYTES = 30 * 1024 * 1024   // 30MB — generous ceiling; the real
                                            // limit that matters is the 20s
                                            // duration cap enforced after
                                            // upload (see cloudinaryUpload.service.js)

const storage = multer.memoryStorage()

function fileFilter(allowedTypes) {
  return (_req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true)
    cb(withUserMessage(
      new Error(`Unsupported file type: ${file.mimetype}`),
      `That file type isn\u2019t supported.${allowedTypes === IMAGE_TYPES ? ' Please upload a JPG, PNG or WebP image.' : ''}`, 400))
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
    cb(withUserMessage(new Error(`Unexpected field: ${file.fieldname}`), 'That file wasn\u2019t expected. Please try again.', 400))
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
])

const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024  // 15MB — plenty for a PDF/Word/Excel diet plan

/**
 * Single document upload — field name "file". Used by Diet Plans, where a
 * trainer can hand a member a plan as a PDF/Word/Excel/image instead of
 * (or alongside) building one out meal-by-meal.
 */
export const uploadDietFile = multer({
  storage,
  limits:     { fileSize: DOCUMENT_MAX_BYTES },
  fileFilter: fileFilter(DOCUMENT_TYPES),
}).single('file')

/**
 * Wraps a multer middleware so its errors come back as normal JSON API
 * errors instead of multer's default stack-trace-y error shape.
 */
export function handleUploadErrors(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next()
      if (err instanceof multer.MulterError) {
        const friendly = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.'
          : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'That file wasn\u2019t expected. Please choose a single image.'
          : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files were selected.'
          : 'The upload didn\u2019t work. Please try again.'
        return res.status(400).json({ message: devOr(`Upload error: ${err.message} (${err.code})`, friendly) })
      }
      // File-type errors carry a plain-language message; anything else (e.g. cloud storage) must not leak its wording.
      return res.status(err.userMessage ? 400 : 502).json({
        message: devOr(err.message || 'Upload failed', err.userMessage || 'The upload didn\u2019t work. Please try again.'),
      })
    })
  }
}
