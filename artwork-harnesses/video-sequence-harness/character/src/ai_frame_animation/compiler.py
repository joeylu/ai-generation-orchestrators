"""Deterministically compile a validated motion intent into the existing job contract."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from .canonical import canonical_sha256, fingerprint, rooted_path, stamp_document
from .intent import delivery_continuity, validate_character_motion_intent
from .reference_preparation import load_reference_preparation


COMPILER_VERSION = "ai_frame_animation_intent_compiler_v1"
COMPILATION_SCHEMA = "ai_frame_animation_intent_compilation_v1"
PROMPT_MAX_CHARS = 7000


def _list(items: list[str]) -> str:
    return "；".join(items) if items else "无额外指定项"


def _render_prompt(intent: Mapping[str, Any]) -> str:
    motion = intent["motion_contract"]
    spatial = intent["spatial_contract"]
    amplitude = {
        "subtle": "极轻微", "low": "小幅", "medium": "中等", "high": "大幅",
        "exaggerated": "夸张", "custom": "严格按动作目标指定的幅度",
    }[motion["amplitude"]["value"]]
    continuity = {
        "seamless_loop": "无缝循环；结尾与开头姿态及运动趋势平滑衔接，不增加终止停顿。",
        "loop_return": "动作结束回到起始姿态，保持首尾平滑衔接。",
        "continuous_cycle": "保持周期和节奏连续，不在末尾强行停止。",
        "one_shot_settle": "完成一次动作后自然稳定，不返回起始姿态、不重复循环。",
        "terminal_hold": "到达指定最终姿态并保持，不返回起始姿态、不重复循环。",
    }[motion["continuity"]["value"]]
    translation = {
        "stationary": "主体不发生整体位移，局部动作仍按运动约束执行。",
        "allowed": "允许动作目标需要的主体位移，不额外添加移动轨迹。",
        "required": "必须表现动作目标指定的主体位移，不改成原地表演。",
    }[spatial["subject_translation"]["value"]]
    turn = {
        "locked": "保持主体朝向，不额外转身。",
        "allowed": "允许动作目标需要的主体转向，不额外添加旋转。",
        "turnaround_required": "必须表现动作目标指定的主体转向。",
    }[spatial["subject_turn"]["value"]]
    camera = {
        "locked": "镜头、视角和缩放固定，不摇移、不推拉、不切镜。",
        "allowed": "允许动作目标指定的镜头运动，不额外发明运镜。",
        "required": "必须执行动作目标指定的镜头运动，不用主体移动替代运镜。",
    }[spatial["camera_motion"]["value"]]
    lines = [
        f"动作类型：{intent['action_type']['value']}。",
        f"动作目标：{intent['motion_goal']['value']}",
        f"必须保持的主体特征：{_list(intent['subject_preserve']['value'])}。",
        f"必须发生的运动：{_list(motion['must_move']['value'])}。",
        f"允许的附加运动：{_list(motion['may_move']['value'])}。",
        f"必须保持不变：{_list(motion['must_lock']['value'])}。",
        f"动作幅度：{amplitude}。",
        f"连续性要求：{continuity}",
        f"主体位移：{translation}",
        f"主体转向：{turn}",
        f"镜头约束：{camera}",
        "运动过程中保持完整主体可见，不裁切主体；不要重新设计角色或增加无关表演。",
    ]
    if motion["key_poses"]["value"]:
        lines.append("动作阶段按以下顺序执行，不凭空指定时间点：")
        for index, pose in enumerate(motion["key_poses"]["value"], 1):
            lines.append(f"{index}. {'必需' if pose['required'] else '可选'}阶段 {pose['role']}：{pose['description']}")
    prompt = "\n".join(lines)
    if len(prompt) > PROMPT_MAX_CHARS:
        raise ValueError("intent_compiler_prompt_too_long")
    return prompt


def reference_binding_for_job(root: Path, job: Mapping[str, Any], prepared_reference: str | Path | None = None) -> dict[str, Any]:
    character = job.get("character")
    if not isinstance(character, Mapping) or not isinstance(character.get("reference"), str):
        raise ValueError("intent_compiler_job_invalid")
    original = rooted_path(root, character["reference"], must_exist=True)
    original_fingerprint = fingerprint(original, media_type="image")
    if prepared_reference is None:
        return {
            "source_sha256": original_fingerprint["sha256"],
            "foreground_sha256": original_fingerprint["sha256"],
            "preparation_sha256": None,
        }
    preparation = load_reference_preparation(root, prepared_reference)
    if preparation["source"]["sha256"] != original_fingerprint["sha256"]:
        raise ValueError("intent_compiler_preparation_source_mismatch")
    return {
        "source_sha256": preparation["source"]["sha256"],
        "foreground_sha256": preparation["foreground"]["sha256"],
        "preparation_sha256": preparation["binding_sha256"],
    }


def compile_intent_to_job(
    intent_value: object,
    job_template: Mapping[str, Any],
    root: Path,
    *,
    prepared_reference: str | Path | None = None,
) -> dict[str, Any]:
    """Compile without LLM, provider, media generation, or filesystem writes."""

    intent = validate_character_motion_intent(intent_value)
    if not isinstance(job_template, Mapping) or set(job_template) != {
        "schema_version", "job_id", "character", "motion", "delivery", "provider",
    }:
        raise ValueError("intent_compiler_job_invalid")
    expected_reference = reference_binding_for_job(root.resolve(strict=True), job_template, prepared_reference)
    if intent["reference"] != expected_reference:
        raise ValueError("intent_compiler_reference_mismatch")
    prompt = _render_prompt(intent)
    compiled = deepcopy(dict(job_template))
    if not isinstance(compiled.get("motion"), dict):
        raise ValueError("intent_compiler_job_invalid")
    compiled["motion"] = {"request": prompt, "continuity": delivery_continuity(intent)}
    report = stamp_document({
        "schema_version": COMPILATION_SCHEMA,
        "compiler_version": COMPILER_VERSION,
        "intent_sha256": intent["intent_sha256"],
        "prompt_sha256": canonical_sha256(prompt),
        "reference": expected_reference,
        "checks": [
            "intent_contract", "intent_digest", "decision_provenance", "semantic_conflicts",
            "reference_binding", "prompt_length", "delivery_continuity_projection",
        ],
    }, "compilation_sha256")
    compiled["intent_compilation"] = report
    return compiled
