#!/usr/bin/env bash
# Start a local vLLM server (OpenAI-compatible API) for Agent Brain.
# Usage: scripts/start-vllm.sh [model]      (default: Qwen3-4B-Instruct-2507-FP8)
set -euo pipefail

MODEL="${1:-${VLLM_MODEL:-Qwen/Qwen3-4B-Instruct-2507-FP8}}"
NAME="${VLLM_CONTAINER:-agent-brain-vllm}"
PORT="${VLLM_PORT:-8000}"
# v0.10.2 is built on CUDA 12.8 (works with driver 570); :latest needs CUDA 12.9.
IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.10.2}"

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Removing old container $NAME"
  docker rm -f "$NAME" >/dev/null
fi

docker run -d --name "$NAME" \
  --runtime nvidia --gpus all \
  --ipc=host \
  -p "$PORT:8000" \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  ${HF_TOKEN:+-e HF_TOKEN="$HF_TOKEN"} \
  "$IMAGE" \
  --model "$MODEL" \
  --served-model-name qwen3-4b \
  --max-model-len "${VLLM_MAX_LEN:-8192}" \
  --gpu-memory-utilization "${VLLM_GPU_UTIL:-0.85}"

echo "vLLM starting: model=$MODEL  →  http://localhost:$PORT/v1  (served as \"qwen3-4b\")"
echo "Follow logs:   docker logs -f $NAME"
echo "Ready check:   curl -s localhost:$PORT/v1/models"
