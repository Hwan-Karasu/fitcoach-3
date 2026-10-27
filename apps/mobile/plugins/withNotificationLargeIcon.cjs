const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

/**
 * Большой цветной значок уведомлений Android: expo-notifications читает его из метаданных
 * `expo.modules.notifications.large_notification_icon`, но штатный плагин задаёт только малый (силуэт).
 * Часы, получающие копию уведомления, показывают именно большой значок как значок приложения.
 */
const META_KEY = "expo.modules.notifications.large_notification_icon";
const RESOURCE = "notification_large_icon";

module.exports = function withNotificationLargeIcon(config, { icon }) {
  const copied = withDangerousMod(config, ["android", (current) => {
    const directory = path.join(current.modRequest.platformProjectRoot, "app/src/main/res/drawable-xxhdpi");
    fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(path.resolve(current.modRequest.projectRoot, icon), path.join(directory, `${RESOURCE}.png`));
    return current;
  }]);
  return withAndroidManifest(copied, (current) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(current.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, META_KEY, `@drawable/${RESOURCE}`, "resource");
    return current;
  });
};
