export default function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}]`, err.stack || err.message)

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0]
    return res.status(409).json({ message: `'${field}' already exists` })
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message)
    return res.status(400).json({ message: messages.join(', ') })
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Invalid token' })
  }

  const status  = err.statusCode || err.status || 500
  const message = err.message || 'Internal server error'

  res.status(status).json({
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
