import webpush from 'web-push'

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:hello@fitos.in',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  )
}

export default webpush
