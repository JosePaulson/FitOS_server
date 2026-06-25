import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const result    = config({ path: join(__dirname, '../.env') })

if (result.error) {
  console.error('❌ Could not load server/.env:', result.error.message)
  console.error('   Copy server/.env.example to server/.env and fill in the values.')
  process.exit(1)
}

const REQUIRED = ['MONGO_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET']
const missing  = REQUIRED.filter((k) => !process.env[k])
if (missing.length) {
  console.error('❌ Missing required environment variables:', missing.join(', '))
  console.error('   Check your server/.env file.')
  process.exit(1)
}
