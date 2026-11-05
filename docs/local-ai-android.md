# Android local AI (opt-in)

The local inference implementation is separate from the Easybook BYOK/account API. It is **Android-only**, does not require signing in, and never sends prompt or note content to the model download host. Downloading a model requires an internet connection; subsequent inference uses local model files.

## Integration

- `LocalAiModels`: fixed allowlist of model downloads, Android DownloadManager, size/free-space checks, SHA-256 integrity verification, file deletion. Weights are stored in Android app-specific external files storage (`models/`), never in the APK.
- `LocalAiEngine`: LiteRT-LM 0.18.0, CPU backend, one background inference executor, bounded text prompt, streamed text and stop support.
- `SecurityManager`: explicit `ai.local.*` bridge allowlist. `MainActivity`: generation callback is scoped to the current WebView document generation.
- `index.html`: on-demand downloads in AI settings; installed models appear in both the global chat model picker and the current-note writing panel. The BYOK selection remains independent.

## Model artifacts

The model files below are resolved from the corresponding `litert-community` Hugging Face repository. The digest must be revalidated against the upstream file page before an intentional model upgrade; a changed upstream artifact will fail validation rather than silently replacing the vetted file.

| Model | Filename | SHA-256 |
| --- | --- | --- |
| Qwen3 0.6B | `Qwen3-0.6B.litertlm` | `c5f39b4191926786c3e6668b62af4d6eb15248dfc7a5348252a9b406f33f2108` |
| Gemma 4 E2B | `gemma-4-E2B-it.litertlm` | `181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c` |
| Gemma 4 E4B | `gemma-4-E4B-it.litertlm` | `0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0` |

Upstream files: [Qwen3](https://huggingface.co/litert-community/Qwen3-0.6B/blob/main/Qwen3-0.6B.litertlm), [Gemma 4 E2B](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/blob/main/gemma-4-E2B-it.litertlm), [Gemma 4 E4B](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/blob/main/gemma-4-E4B-it.litertlm).

## Intentional scope limits

- The initial runtime is **CPU-only**. GPU/NPU acceleration must be device-tested before promotion.
- Text attachments can be passed as prompt text; image/audio understanding and autonomous local tool calling are not exposed yet. The local Agent view remains a text assistant and cannot modify notes.
- Android system speech recognition is a separate capability; it may use a network recognizer depending on device configuration.
- Model updates currently require refreshing the pinned catalog through an app update. Independent signed catalog updates are follow-up work.
- The LiteRT runtime itself adds size to the Android APK even though model weights are strictly opt-in.
- Before publishing an Android release, compile against Android 35 and refresh Android transitive dependency licenses (`npm run licenses:android`), then test on a real arm64 device with ample disk and RAM.
