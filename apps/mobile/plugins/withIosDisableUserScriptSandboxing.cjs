const { withXcodeProject } = require("expo/config-plugins");

module.exports = function withIosDisableUserScriptSandboxing(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key]?.buildSettings;
      if (buildSettings) {
        buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      }
    }
    return cfg;
  });
};
