// Generate PWA icons: teal rounded square with white "U"
const sharp = require('sharp')

async function makeIcon(size) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#0f766e"/>
    <text x="50%" y="54%" font-family="Arial, Helvetica, sans-serif" font-size="${size * 0.55}" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">U</text>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(`/home/z/my-project/public/icons/icon-${size}.png`)
  console.log(`icon-${size}.png done`)
}

;(async () => {
  await makeIcon(192)
  await makeIcon(512)
})()
