"""Standalone episode planner and deterministic H3 shot compiler.

The Python worker owns Twitch-mode planning; no web service or Redis is used.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
import aiohttp

SPEC = json.loads(Path(__file__).with_name("episode_spec.json").read_text())


def compile_plan(raw: dict) -> dict:
    def text(obj, key, limit):
        value = obj.get(key)
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            raise ValueError(f"{key} must be nonempty text of at most {limit} characters")
        return value.strip()
    def sentence(value):
        return value.rstrip(".!?")
    if not isinstance(raw, dict):
        raise ValueError("Expected a plan object")
    a, b = text(raw, "appearanceA", 95), text(raw, "appearanceB", 95)
    setting, ending = text(raw, "setting", 70), text(raw, "ending", 140)
    winner = raw.get("winner")
    if winner not in ("A", "B"):
        raise ValueError("winner must be A or B")
    challenges = {}
    for key in ("challengeA", "challengeB"):
        if key not in raw:
            raise ValueError(f"Missing {key}")
        value = raw[key]
        if value is not None:
            value = text(raw, key, 60)
            if len(value.split()) > 8:
                raise ValueError(f"{key} must have at most eight words")
        challenges[key] = value
    beats = raw.get("beats")
    if not isinstance(beats, list) or len(beats) != len(SPEC["stages"]):
        raise ValueError("Exactly twelve beats required")
    referee = SPEC["referee"]
    shots = []
    for index, (beat, stage) in enumerate(zip(beats, SPEC["stages"])):
        if not isinstance(beat, dict):
            raise ValueError("Each beat must be an object")
        action = text(beat, "action", 130)
        narration = text(beat, "narration", 140)
        sound = text(beat, "sound", 200)
        if len(sound) > 50:
            sound = re.sub(r"\s+\S*$", "", sound[:50])
        camera = beat.get("camera")
        if camera not in SPEC["cameras"]:
            raise ValueError("Choose a listed camera")
        dialogue = None
        if index == 5:
            dialogue = {"speaker": "referee", "text": "Fighters, ready? Let the match begin!"}
        elif index in (1, 3):
            side = "A" if index == 1 else "B"
            if challenges["challenge" + side]:
                dialogue = {"speaker": side, "text": challenges["challenge" + side]}
        if dialogue:
            subject = referee if dialogue["speaker"] == "referee" else a if dialogue["speaker"] == "A" else b
            speech = f'Focus on {sentence(subject)} saying in clear English: “{dialogue["text"]}”. Only this line is spoken. Quiet effects.'
        else:
            speech = "Instrumental score and nonverbal effects only. Closed mouths; no speech or vocalizing."
        scope = stage["cast"]
        cast = a if scope == "A" else b if scope == "B" else f"{sentence(a)}. {sentence(b)}" + (f". {referee}" if scope == "all" else "")
        if index == 11:
            winning, losing = (a, b) if winner == "A" else (b, a)
            cast = f"Winner: {sentence(winning)}. Defeated opponent: {sentence(losing)}. {referee}"
        staging = "Solo fighter, full body visible. " if scope in ("A", "B") else "Wide face-off: first fighter left, second right, referee between. " if index == 4 else "Loser stays down; winner celebrates; referee indicates winner. Hold the result. " if index == 11 else ""
        prompt = f"Hard cut to {camera.lower()}: {sentence(action)}. {sentence(cast)}. Arena: {sentence(setting)}. {staging}Stylized realism. Sound: {sentence(sound)}. {speech}"
        if len(prompt) > 800:
            raise ValueError("Episode shot exceeds H3 prompt limit")
        shots.append({"prompt": prompt, "seconds": stage["seconds"], "title": stage["title"],
            "narration": ending if index == 11 else narration, "dialogue": dialogue,
            "announcer": 1 if index == 2 else 0 if index in (0, 11) else index % 2,
            "referenceRole": "fighterA" if index < 2 else "fighterB" if index < 4 else "faceoff" if index == 4 else None})
    return {"winner": winner, "ending": ending, "setting": setting, "shots": shots,
        "referenceFrames": [
            {"role": "fighterA", "prompt": f"{a} alone, full body warming up in the ring. Arena: {setting}. Stylized realism."},
            {"role": "fighterB", "prompt": f"{b} alone, full body warming up in the ring. Arena: {setting}. Stylized realism."},
            {"role": "faceoff", "prompt": f"{a} on the left facing {b} on the right; {referee} between them. Both full bodies visible, accurate relative scale. Arena: {setting}. Stylized realism."}]}


class EpisodePlanner:
    def __init__(self, api_key, base_url, model):
        self.api_key, self.base_url, self.model = api_key, base_url.rstrip("/"), model

    async def episode(self, inputs):
        messages = [{"role": "system", "content": SPEC["system"]}, {"role": "user", "content": json.dumps(inputs)}]
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            for attempt in range(2):
                async with session.post(self.base_url + "/chat/completions", headers={"Authorization": "Bearer " + self.api_key},
                        json={"model": self.model, "temperature": 0.7, "response_format": {"type": "json_object"}, "messages": messages}) as response:
                    if response.status != 200:
                        raise RuntimeError(f"Episode writer returned HTTP {response.status}")
                    body = await response.json()
                content = body["choices"][0]["message"]["content"]
                try:
                    candidate = json.loads(content)
                    return compile_plan(candidate)
                except (ValueError, TypeError, KeyError) as error:
                    if attempt:
                        raise
                    messages.extend([{"role": "assistant", "content": content},
                        {"role": "user", "content": f"Repair this plan: {error}. Preserve valid fields, winner and story order. Return complete JSON."}])
