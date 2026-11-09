/** Images de lancement iOS (public/splash, générées par scripts/generate-pwa-assets.mjs). [largeur CSS, hauteur CSS, ratio de pixels]. */
const DEVICES: [number, number, number][] = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3],
  [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2], [360, 780, 3],
  [1032, 1376, 2], [1024, 1366, 2], [834, 1210, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2],
];

/**
 * Une entrée par appareil et par orientation : en paysage, iOS reçoit une image dédiée (fond ivoire, même logo)
 * plutôt que le fond blanc par défaut. device-width/height restent ceux du mode portrait, comme le veut WebKit.
 */
export const APPLE_STARTUP_IMAGES = DEVICES.flatMap(([w, h, r]) => [
  {
    url: `/splash/apple-splash-${w * r}-${h * r}.png`,
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
  },
  {
    url: `/splash/apple-splash-${h * r}-${w * r}.png`,
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: landscape)`,
  },
]);
