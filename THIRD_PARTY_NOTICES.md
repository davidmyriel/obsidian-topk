# Third-party notices

TopK Visual Search is MIT licensed (see `LICENSE`). Its released `main.js` bundles:

| Component                                                                                   | Version | License                           | Source                                  |
| ------------------------------------------------------------------------------------------- | ------- | --------------------------------- | --------------------------------------- |
| `@bufbuild/protobuf`                                                                        | 2.16.0  | Apache-2.0 AND BSD-3-Clause       | https://github.com/bufbuild/protobuf-es |
| Code generated from TopK's protocol definitions (`src/topk/gen`, from `vendor/topk-protos`) | v0.16.1 | MIT, Copyright (c) 2025 FAFO LABS | `vendor/topk-protos/LICENSE`            |

pdf.js and the Obsidian API are provided by Obsidian at runtime and are not bundled. Development
dependencies are not shipped.

The full license texts are in the upstream repositories linked above and in `vendor/topk-protos/LICENSE`.
Keep this list current when a runtime dependency changes. `npm ls --omit=dev` shows what can end up
in the bundle.
