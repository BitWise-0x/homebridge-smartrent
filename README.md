<span align="center">

<h1>
  <a href="https://github.com/BitWise-0x/homebridge-smartrent">
    <img align="center" src="homebridge-ui/public/banner.png" />
  </a>
  <br />
  Homebridge SmartRent
</h1>

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm version](https://badgen.net/npm/v/@jackietreeh0rn/homebridge-smartrent?color=purple&icon=npm&label)](https://www.npmjs.com/package/@jackietreeh0rn/homebridge-smartrent)
[![npm downloads](https://badgen.net/npm/dw/@jackietreeh0rn/homebridge-smartrent?color=purple&icon=npm&label)](https://www.npmjs.com/package/@jackietreeh0rn/homebridge-smartrent)
[![GitHub Stars](https://badgen.net/github/stars/BitWise-0x/homebridge-smartrent?color=cyan&icon=github)](https://github.com/BitWise-0x/homebridge-smartrent)
[![GitHub Last Commit](https://badgen.net/github/last-commit/BitWise-0x/homebridge-smartrent?color=cyan&icon=github)](https://github.com/BitWise-0x/homebridge-smartrent)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/BitWise-0x/homebridge-smartrent.svg)](https://github.com/BitWise-0x/homebridge-smartrent/pulls)
[![GitHub issues](https://img.shields.io/github/issues/BitWise-0x/homebridge-smartrent.svg)](https://github.com/BitWise-0x/homebridge-smartrent/issues)
[![FOSSA Status](https://app.fossa.com/api/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent.svg?type=shield&issueType=license)](https://app.fossa.com/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent?ref=badge_shield&issueType=license)
[![FOSSA Status](https://app.fossa.com/api/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent.svg?type=shield&issueType=security)](https://app.fossa.com/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent?ref=badge_shield&issueType=security)

Verified [Homebridge](https://homebridge.io) plugin for [SmartRent](https://smartrent.com), allowing you to control your SmartRent devices with [Apple Home](https://www.apple.com/ios/home/).

</span>

## 🔄 Supported Devices

Homebridge SmartRent currently supports these devices through a SmartRent hub:

- 🔒 Locks
- 💧 Leak sensors
- 🔌 Switches
- 🌡 Thermostats
- 🎚 Multilevel | Dimmer Switches

## ✅ Usage

## Installation

[Install Homebridge](https://github.com/homebridge/homebridge/wiki), add it to [Apple Home](https://github.com/homebridge/homebridge/blob/main/README.md#adding-homebridge-to-ios), then install and configure Homebridge SmartRent.

### Recommended

1. Open the [Homebridge UI](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-macOS#complete-login-to-the-homebridge-ui).

2. Open the Plugins tab, search for `homebridge-smartrent`, and install the plugin.

3. Log in to SmartRent through the settings panel, and optionally set your unit name.

![Plugin settings screenshot](screenshot.png)

### Manual

1. Install the plugin using NPM:

   ```sh
   npm i -g @jackietreeh0rn/homebridge-smartrent
   ```

2. Configure the SmartRent platform in `~/.homebridge/config.json` as shown in [`config.example.json`](./config.example.json).

3. Start Homebridge:

   ```sh
   homebridge -D
   ```

## Configuration

All configuration values are strings.

| Property    | Description                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `email`     | SmartRent account email                                                                                                              |
| `password`  | SmartRent account password                                                                                                           |
| `tfaSecret` | If you have enabled two-factor authentication on your SmartRent account, enter the secret used to seed the 2FA token                 |
| `unitName`  | Only necessary if you have multiple units in your SmartRent account. Get the name from the top of the More tab in the SmartRent app. |

## 🛠 Development

### Setup Development Environment

To develop Homebridge SmartRent you must have Node.js 12 or later installed, and a modern code editor such as [VS Code](https://code.visualstudio.com/). This plugin template uses [TypeScript](https://www.typescriptlang.org/) to make development easier and comes with pre-configured settings for [VS Code](https://code.visualstudio.com/) and ESLint. If you are using VS Code install these extensions:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [EditorConfig](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig)

### Install Development Dependencies

Using a terminal, navigate to the project folder and run this command to install the development dependencies:

```sh

npm install

```

### Build Plugin

TypeScript needs to be compiled into JavaScript before it can run. The following command will compile the contents of your [`src`](./src) directory and put the resulting code into the `dist` folder.

```sh

npm run build

```

### Link To Homebridge

Run this command so your global install of Homebridge can discover the plugin in your development environment:

```sh

npm link

```

You can now start Homebridge, use the `-D` flag so you can see debug log messages in your plugin:

```sh

homebridge -D

```

### Watch For Changes and Build Automatically

If you want to have your code compile automatically as you make changes, and restart Homebridge automatically between changes you can run:

```sh

npm run watch

```

This will launch an instance of Homebridge in debug mode which will restart every time you make a change to the source code. It will load the config stored in the default location under `~/.homebridge`. You may need to stop other running instances of Homebridge while using this command to prevent conflicts. You can adjust the Homebridge startup command in the [`nodemon.json`](./nodemon.json) file.

## Help! I'm Having Issues!

If you are having issues with this plugin, please check the following:

- [Homebridge Basic Troubleshooting](https://github.com/homebridge/homebridge/wiki/Basic-Troubleshooting)

If you're still having issues, let us know by opening
an [issue](https://github.com/BitWise-0x/homebridge-smartrent/issues/new/choose) on GitHub. Please fill out
the template with as much information as possible to help us help you.

## I Have an Idea for a New Feature!

If you have a feature request, please checkout our [Contribution](./CONTRIBUTING.md) guide and open
a [feature request issue](https://github.com/BitWise-0x/homebridge-smartrent/issues/new?template=feature-request.md)

## I Want to Contribute!

If you want to contribute to this project, please checkout our [Contribution](./CONTRIBUTING.md) guide. We welcome
contributions of all kinds!

## Code of Conduct

Please checkout our [Code of Conduct](./CODE_OF_CONDUCT.md) for more information.

## License

[GNU GENERAL PUBLIC LICENSE, Version 3](https://www.gnu.org/licenses/gpl-3.0.en.html)

<!-- [![FOSSA Status](https://app.fossa.com/api/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent.svg?type=large&issueType=license)](https://app.fossa.com/projects/custom%2B56237%2Fgithub.com%2FJackieTreeh0rn%2Fhomebridge-smartrent?ref=badge_large&issueType=license) -->

## Disclaimer

This project is not endorsed by, directly affiliated with, maintained, authorized, or sponsored by SmartRent Technologies, Inc or Apple Inc. All product and company names are the registered trademarks of their original owners. The use of any trade name or trademark is for identification and reference purposes only and does not imply any association with the trademark holder of their product brand.
