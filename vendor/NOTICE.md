# 附带的第三方文件

完整许可文本见 [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt)。

## vendor/ort：onnxruntime-web 1.31.1（含 onnxruntime-common 1.31.1）

Copyright (c) Microsoft Corporation. MIT License。
只取了 Node 里跑 wasm 需要的文件：`ort.node.min.mjs`（把 `onnxruntime-common` 的导入改成了相对路径 `./common/index.js`）、
`ort-wasm-simd-threaded.mjs`、`ort-wasm-simd-threaded.wasm`，以及 onnxruntime-common 的 `dist/esm/*.js`。
浏览器里的人声检测另用 `ort.wasm.bundle.min.mjs`（原样复制，和上面共用同一个 `.wasm`）。
来源：https://www.npmjs.com/package/onnxruntime-web

## vendor/smart-turn：smart-turn v3.2（CPU，int8）

pipecat-ai/smart-turn-v3，BSD 2-Clause License。
文件 `smart-turn-v3.2-cpu.onnx`，sha256 `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`。
来源：https://huggingface.co/pipecat-ai/smart-turn-v3

## vendor/silero：Silero VAD v5

snakers4/silero-vad，MIT License（Copyright (c) 2020-present Silero Team）。
文件 `silero_vad.onnx`，sha256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`。
来源：https://github.com/snakers4/silero-vad

## 更新方法

`npm install onnxruntime-web@<版本>` 到临时目录，按上面的清单重新复制、改导入；模型从 Hugging Face 下载后核对 sha256。
