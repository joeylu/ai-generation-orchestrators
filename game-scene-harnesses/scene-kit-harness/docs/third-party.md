# Local Studio dependencies

The offline Node core uses built-ins. The optional Studio declares exact versions
in `package.json`; `package-lock.json` fixes the public npm dependency closure.

| Direct package | Version | License | Source |
| --- | --- | --- | --- |
| pixi.js | 8.20.1 | MIT | [PixiJS](https://github.com/pixijs/pixijs) |
| pixi-viewport | 6.0.3 | MIT | [pixi-viewport](https://github.com/pixijs-userland/pixi-viewport) |
| esbuild | 0.25.12 | MIT | [esbuild](https://github.com/evanw/esbuild) |
| playwright | 1.63.0 | Apache-2.0 | [Playwright](https://github.com/microsoft/playwright) |

Installed packages contain their license and notice files. The local browser
bundle retains dependency legal comments. A future distributable must include
the applicable full license/notice texts for its actual contents; this source
prototype is not an immutable public release. Browser installations have their
own terms and are not bundled or automatically downloaded by Studio or tests.

Synthetic fixture PNGs are generated deterministically by this Harness. They
are engineering markers, not third-party game artwork or AI-generated assets.

The bounded ZIP writer implements stored ZIP32 entries from
[PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
sections 4.3.7, 4.3.12 and 4.3.16. It adds no runtime dependency, compression
library or archive extraction endpoint. The specification text is not bundled.
