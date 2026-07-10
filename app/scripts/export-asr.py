#!/usr/bin/env python3
"""Export iarfmoose/wav2vec2-large-xlsr-kyrgyz (Wav2Vec2ForCTC) to ONNX int8 for the ASR backend.

The model weights are gitignored (~338 MB > GitHub's 100 MB limit), so regenerate them here.

    python3 -m venv .venv && source .venv/bin/activate
    pip install "torch==2.8.0" "transformers==4.57.6" "onnx==1.19.1" "onnxruntime==1.19.2"
    python scripts/export-asr.py

Writes models/{model.onnx, vocab.json, asr-meta.json} — consumed by server/main.ts
(the browser no longer loads the model; see src/lib/asr.ts). NOTE: quantize MatMul ONLY —
dynamic-quantizing the conv feature extractor emits ConvInteger, which onnxruntime-web's wasm
backend does not implement (kept for potential in-browser fallback; convs stay fp32 and the
transformer MatMuls hold most of the weight anyway).
"""
import json
import os
import shutil

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL = "iarfmoose/wav2vec2-large-xlsr-kyrgyz"
OUT = os.path.join(os.path.dirname(__file__), "..", "models")
FP32 = os.path.join(OUT, "model.fp32.onnx")
INT8 = os.path.join(OUT, "model.onnx")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL).eval()
    processor = Wav2Vec2Processor.from_pretrained(MODEL)

    dummy = torch.randn(1, 16000)
    with torch.no_grad():
        torch.onnx.export(
            model, dummy, FP32,
            input_names=["input_values"], output_names=["logits"],
            dynamic_axes={"input_values": {0: "batch", 1: "time"}, "logits": {0: "batch", 1: "frames"}},
            opset_version=14,
        )

    quantize_dynamic(FP32, INT8, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
    os.remove(FP32)
    print("int8 model MB:", os.path.getsize(INT8) // (1024 * 1024))

    vocab = processor.tokenizer.get_vocab()
    with open(os.path.join(OUT, "vocab.json"), "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False)

    meta = {
        "pad_token": processor.tokenizer.pad_token,
        "pad_id": vocab.get(processor.tokenizer.pad_token),
        "word_delimiter": getattr(processor.tokenizer, "word_delimiter_token", "|"),
        "do_normalize": bool(getattr(processor.feature_extractor, "do_normalize", True)),
        "sampling_rate": int(getattr(processor.feature_extractor, "sampling_rate", 16000)),
    }
    with open(os.path.join(OUT, "asr-meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("done:", meta)


if __name__ == "__main__":
    main()
