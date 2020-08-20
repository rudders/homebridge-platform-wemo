# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## [Version 1.6.1](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.6.0...1.6.1) (2020-08-20)

#### Changes

- Fix Formatting.
- Fix warning of node.

## [Version 1.6.0](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.6...1.6.0) (2020-08-14)

#### Changes

- Dimmer Night mode: Poll Brightness when turning the lights on. Thanks, [@leeliu](https://github.com/leeliu)!

  - This allows night mode to function with homebridge knowing correct night mode brightness value when lights turn on. (Previously if dimmer was set to 80% normal and 20% night mode, at night when turning on dimmers, Home app would report 80% brightness when in fact the dimmer is 20% brightness. This fixes and now correctly shows 20% brightness.)

## [Version 1.5.6](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.5...1.5.6) (2020-05-13)

#### Changes

- small repo updates, no new features or bug fixes.

## [Version 1.5.5](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.4...1.5.5) (2020-04-11)

#### Features

- update engine dependencies

## [Version 1.5.4](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.3...1.5.4) (2020-04-11)

#### Features

- remove devDependencies for homebridge-config-ui-x and homebridge.
- update node engine dependencies

## [Version 1.5.3](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.2...1.5.3) (2020-04-08)

#### Features

- Update devDependencies for homebridge-config-ui-x and homebridge.

## [Version 1.5.2](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.1...1.5.2) (2020-04-08)

#### Features

- Spelling Correction

## [Version 1.5.1](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.5.0...1.5.1) (2020-04-07)

#### Features

- Add support for "discoveryInterval" into config.schema.json
- Homebridge Verified

## [Version 1.5.0](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.4.1...1.5.0) (2020-04-06)

#### Features

- Support optional config value "discoveryInterval"
- Add Changelog.
- Repo Updates.

## [Version 1.4.1](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.4.0...1.4.1) (2020-04-06)

#### Features

- Fix miss spelling
- Fix config.schema.json

## [Version 1.4.0](https://github.com/homebridge-plugins/homebridge-platform-wemo/compare/v1.3.8...1.4.0) (2020-04-05)

#### Changes

- Simplify Readme.
- Add config.schema.json for Config UI X support.
- Repo Updates.
