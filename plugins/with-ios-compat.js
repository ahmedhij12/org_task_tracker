const {
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SCENE_DELEGATE_CLASS = `
// iOS 27 kills any app at launch that hasn't adopted the UIScene lifecycle
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). Expo SDK 54's ExpoAppDelegate is
// UIApplicationDelegate-only, so this adopts the scene minimally: React Native still builds the
// window in didFinishLaunching, and this hands that window to the scene UIKit creates for us.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let appDelegate = UIApplication.shared.delegate as? AppDelegate

    let hostWindow = appDelegate?.window ?? UIWindow()
    hostWindow.windowScene = windowScene
    appDelegate?.window = hostWindow
    window = hostWindow
    hostWindow.makeKeyAndVisible()
  }
}
`;

/** Declares the scene manifest so UIKit knows the app adopts scenes, and points it at the class below. */
function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

/** Appends the SceneDelegate to AppDelegate.swift, so no new file has to be added to the Xcode project. */
function withSceneDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(`with-ios-compat expected a Swift AppDelegate, got ${cfg.modResults.language}`);
    }
    if (!cfg.modResults.contents.includes('class SceneDelegate')) {
      cfg.modResults.contents += SCENE_DELEGATE_CLASS;
    }
    return cfg;
  });
}

/**
 * Xcode 27 refuses to build any target below iOS 15, and several pods (GoogleSignIn, AppAuth,
 * RevenueCat, SDWebImage, ReachabilitySwift, and the *_Privacy resource bundles) still declare
 * 9.0-13.4. react_native_post_install doesn't lift all of them, so force the floor ourselves.
 */
function withPodfileDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes('min_deployment_target')) return cfg;

      const anchor = /(\n\s*post_install do \|installer\|\n)/;
      if (!anchor.test(contents)) {
        throw new Error('with-ios-compat could not find post_install in the Podfile');
      }

      const patch = `$1    min_deployment_target = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '15.1')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = Gem::Version.new(build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '0')
        if current < min_deployment_target
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_deployment_target.to_s
        end
      end
    end

`;
      fs.writeFileSync(podfilePath, contents.replace(anchor, patch));
      return cfg;
    },
  ]);
}

module.exports = function withIosCompat(config) {
  return withPodfileDeploymentTarget(withSceneDelegate(withSceneManifest(config)));
};
