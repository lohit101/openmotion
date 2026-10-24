#!/usr/bin/env python3
"""Build matching editable ComfyUI and API graphs from one description."""

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROMPT = "The adult person from the reference image performs the actions in the source video. Preserve the reference person's face, hairstyle, body proportions and clothing throughout. Preserve the source scene, camera movement, lighting, shadows and interactions. Natural live action footage, realistic skin texture and coherent hands."
NEGATIVE = "identity drift, changing face, changing clothes, duplicate person, flicker, warped hands, extra fingers, deformed limbs, waxy skin, oversharpening, blurry face, floating feet"


def describe():
    graph, layout = {}, {}

    def add(key, kind, title, xy, **inputs):
        graph[str(key)] = {"class_type": kind, "inputs": inputs, "_meta": {"title": title}}
        layout[str(key)] = {"pos": xy, "title": title}

    def link(key, slot=0):
        return [str(key), slot]

    add(1, "SwapControls", "01 Shot settings", [0, 0], preset="fast_6_steps", width=480, height=832, fps=16.0, frame_cap=81, skip_frames=0, seed=20261024, dpo_strength=1.0)
    add(2, "VHS_LoadVideo", "02 Upload source video", [350, 0], video="source.mp4", force_rate=link(1, 2), custom_width=link(1), custom_height=0, frame_load_cap=link(1, 3), skip_first_frames=link(1, 4), select_every_nth=1, format="None")
    add(3, "SwapPrepareShot", "Prepare source frames", [350, 450], images=link(2), width=link(1), height=link(1, 1), audio=link(2, 2))
    add(4, "LoadImage", "03 Upload character reference", [0, 500], image="reference.png")
    add(5, "SwapFitReference", "Fit complete reference without stretching", [350, 700], images=link(4), width=link(1), height=link(1, 1))
    add(6, "CheckpointLoaderSimple", "SAM3.1 tracker and prompt encoder", [800, 0], ckpt_name="sam3.1_multiplex_fp16.safetensors")
    add(7, "CLIPTextEncode", "04 Describe source person to track", [800, 200], text="person", clip=link(6, 1))
    add(8, "CLIPTextEncode", "Reference subject to track", [800, 460], text="person", clip=link(6, 1))
    add(9, "SAM3_VideoTrack", "Track source person", [1160, 170], images=link(3), model=link(6), conditioning=link(7), detection_threshold=0.5, max_objects=2, detect_interval=1)
    add(10, "SAM3_VideoTrack", "Track reference person", [1160, 460], images=link(5), model=link(6), conditioning=link(8), detection_threshold=0.5, max_objects=2, detect_interval=1)
    add(11, "SCAIL2ColoredMask", "05 Bind selected person to reference", [1160, 730], driving_track_data=link(9), ref_track_data=link(10), object_indices="0", sort_by="left_to_right", replacement_mode=True)
    add(12, "VHS_VideoCombine", "Check selected person mask", [800, 900], images=link(11), frame_rate=link(1, 2), loop_count=0, filename_prefix="character_swap/mask_preview", format="video/h264-mp4", pingpong=False, save_output=False, pix_fmt="yuv420p", crf=20, save_metadata=True, trim_to_audio=False)
    add(13, "PreviewImage", "Reference identity mask", [1160, 1030], images=link(11, 1))
    add(20, "UNETLoader", "SCAIL-2 INT8 base", [1610, 0], unet_name="wan2.1_14B_SCAIL_2_int8_convrot.safetensors", weight_dtype="default")
    add(21, "LoraLoaderModelOnly", "SCAIL-2 detail DPO LoRA", [1610, 200], model=link(20), lora_name="wan2.1_SCAIL_2_DPO_lora_bf16.safetensors", strength_model=link(1, 8))
    add(22, "SwapOptionalLoRA", "06 Optional model-matched LoRA A", [1610, 410], model=link(21), lora_name="None", strength_model=0.8)
    add(23, "SwapOptionalLoRA", "Optional model-matched LoRA B", [1610, 620], model=link(22), lora_name="None", strength_model=0.8)
    add(24, "LoraLoaderModelOnly", "LightX2V speed adapter", [1610, 830], model=link(23), lora_name="lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", strength_model=link(1, 7))
    add(25, "ModelSamplingSD3", "Sampling model - shared with scheduler", [1610, 1040], model=link(24), shift=5.0)
    add(30, "CLIPLoader", "Wan text encoder", [2020, 0], clip_name="umt5_xxl_fp8_e4m3fn_scaled.safetensors", type="wan", device="default")
    add(31, "CLIPTextEncode", "07 Describe replacement appearance and scene", [2020, 200], text=PROMPT, clip=link(30))
    add(32, "CLIPTextEncode", "Visual defects to avoid", [2020, 530], text=NEGATIVE, clip=link(30))
    add(33, "CLIPVisionLoader", "Reference vision encoder", [2020, 830], clip_name="clip_vision_h.safetensors")
    add(34, "CLIPVisionEncode", "Encode complete reference", [2020, 1010], clip_vision=link(33), image=link(5), crop="none")
    add(35, "VAELoader", "Wan 2.1 video VAE", [2430, 0], vae_name="Wan2_1_VAE_bf16.safetensors")
    add(36, "SwapLoadContext", "08 Previous context - leave blank for new shot", [2430, 180], context_path="", width=link(1), height=link(1, 1), fps=link(1, 2), skip_frames=link(1, 4))
    add(40, "WanSCAILToVideo", "Native character replacement", [2430, 490], positive=link(31), negative=link(32), vae=link(35), width=link(1), height=link(1, 1), length=link(3, 1), batch_size=1, pose_video=link(3), pose_video_mask=link(11), replacement_mode=True, pose_strength=1.0, pose_start=0.0, pose_end=1.0, reference_image=link(5), reference_image_mask=link(11, 1), clip_vision_output=link(34), video_frame_offset=link(36, 1), previous_frame_count=5, previous_frames=link(36))
    add(41, "KSamplerSelect", "Euler sampler", [2890, 0], sampler_name="euler")
    add(42, "BasicScheduler", "Scheduler matches the sampling model", [2890, 180], model=link(25), scheduler="simple", steps=link(1, 5), denoise=1.0)
    add(43, "SamplerCustom", "09 Generate replacement", [2890, 440], model=link(25), add_noise=True, noise_seed=link(1, 9), cfg=link(1, 6), positive=link(40), negative=link(40, 1), sampler=link(41), sigmas=link(42), latent_image=link(40, 2))
    add(44, "VAEDecodeTiled", "Decode with bounded video tiles", [2890, 800], samples=link(43), vae=link(35), tile_size=512, overlap=128, temporal_size=32, temporal_overlap=8)
    add(45, "SwapFinalizeShot", "Trim padding and overlap; align audio", [3330, 0], images=link(44), source_count=link(3, 2), overlap=link(36, 2), fps=link(1, 2), audio=link(3, 3))
    add(46, "VHS_VideoCombine", "10 Final MP4 with source audio", [3330, 300], images=link(45), audio=link(45, 1), frame_rate=link(1, 2), loop_count=0, filename_prefix="character_swap/shot", format="video/h264-mp4", pingpong=False, save_output=True, pix_fmt="yuv420p", crf=17, save_metadata=True, trim_to_audio=False)
    add(47, "SwapSaveContext", "Continuation file for the next pass", [3330, 1000], images=link(45, 2), fps=link(1, 2), skip_frames=link(1, 4))
    add(48, "PreviewAny", "Next context path and source end frame", [3330, 1300], source=link(47, 1))
    return graph, layout


def is_link(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int)


def ancestors(graph, targets):
    keep = set()

    def visit(key):
        if key in keep:
            return
        keep.add(key)
        for value in graph[key]["inputs"].values():
            if is_link(value):
                visit(value[0])
    for key in targets:
        visit(str(key))
    return {key: value for key, value in graph.items() if key in keep}


def ui_graph(graph, layout, catalog, title):
    result = {"last_node_id": max(map(int, graph)), "last_link_id": 0, "nodes": [], "links": [], "groups": [], "config": {}, "extra": {"ds": {"scale": 0.38, "offset": [90, 100]}, "frontendVersion": "1.57.1", "VHS_MetadataImage": True, "VHS_KeepIntermediate": False, "character_swap_version": 1}, "version": 0.4}
    node_map = {}
    for order, (key, data) in enumerate(graph.items()):
        schema = catalog[data["class_type"]]
        multiline = sum(bool((value[1] if len(value) > 1 else {}).get("multiline")) for value in schema["input"].get("required", {}).values())
        node = {"id": int(key), "type": data["class_type"], "pos": list(layout[key]["pos"]), "size": [360 if key in ["31", "32", "40"] else 320, 300 if multiline else 220], "flags": {}, "order": order, "mode": 0, "inputs": [], "outputs": [], "title": data["_meta"]["title"], "properties": {"Node name for S&R": data["class_type"]}, "widgets_values": []}
        if data["class_type"] == "SwapControls":
            node["size"] = [320, 380]
        for section in ["required", "optional"]:
            for name, definition in schema["input"].get(section, {}).items():
                kind = definition[0]
                options = definition[1] if len(definition) > 1 else {}
                widget = isinstance(kind, list) or kind in ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO")
                value = data["inputs"].get(name)
                connected = is_link(value)
                if not widget or connected:
                    entry = {"name": name, "type": "COMBO" if isinstance(kind, list) else kind, "link": None}
                    if widget:
                        entry["widget"] = {"name": name}
                    if section == "optional":
                        entry["shape"] = 7
                    node["inputs"].append(entry)
                if widget:
                    fallback = options.get("default", kind[0] if isinstance(kind, list) and kind else "")
                    node["widgets_values"].append(fallback if connected or value is None else value)
                    if options.get("control_after_generate"):
                        node["widgets_values"].append("fixed")
        for slot, kind in enumerate(schema.get("output", [])):
            names = schema.get("output_name", schema["output"])
            node["outputs"].append({"name": names[slot], "type": kind, "links": []})
        if data["class_type"].startswith("VHS_"):
            node["widgets_values"] = {name: value for name, value in data["inputs"].items() if not is_link(value)}
            node["widgets_values"]["videopreview"] = {"hidden": False, "paused": True, "params": {}}
            node["size"] = [340, 560]
        else:
            ports = max(len(node["inputs"]), len(node["outputs"]))
            widget_height = len(node["widgets_values"]) * 26
            node["size"][1] = max(180, ports * 22 + widget_height + 70)
            if multiline:
                node["size"][1] += 180
            if data["class_type"] in ("LoadImage", "PreviewImage"):
                node["size"][1] += 260
        result["nodes"].append(node)
        node_map[key] = node
    for key, data in graph.items():
        for name, value in data["inputs"].items():
            if not is_link(value):
                continue
            origin, origin_slot = value
            target_slot = next(i for i, inp in enumerate(node_map[key]["inputs"]) if inp["name"] == name)
            result["last_link_id"] += 1
            lid = result["last_link_id"]
            kind = node_map[origin]["outputs"][origin_slot]["type"]
            result["links"].append([lid, int(origin), origin_slot, int(key), target_slot, kind])
            node_map[origin]["outputs"][origin_slot]["links"].append(lid)
            node_map[key]["inputs"][target_slot]["link"] = lid
    for left in sorted({node["pos"][0] for node in result["nodes"]}):
        bottom = 0
        for node in sorted((n for n in result["nodes"] if n["pos"][0] == left), key=lambda n: n["pos"][1]):
            node["pos"][1] = max(node["pos"][1], bottom)
            bottom = node["pos"][1] + node["size"][1] + 80
    ranges = [("01 Inputs", 0, 720, "#35586e"), ("02 Person tracking and masks", 780, 750, "#546741"), ("03 INT8 model and LoRAs", 1580, 380, "#755b41"), ("04 Identity and text", 1990, 400, "#654a73"), ("05 Native replacement", 2400, 430, "#41686b"), ("06 Sampling", 2860, 400, "#6b5151"), ("07 Export and continuation", 3300, 420, "#4a6650")]
    for index, (label, left, width, color) in enumerate(ranges):
        members = [node for node in result["nodes"] if left <= node["pos"][0] < left + width]
        if members:
            x0 = min(node["pos"][0] for node in members) - 20
            x1 = max(node["pos"][0] + node["size"][0] for node in members) + 20
            y1 = max(node["pos"][1] + node["size"][1] for node in members) + 25
            result["groups"].append({"id": index + 1, "title": label, "bounding": [x0, -65, x1 - x0, y1 + 65], "color": color, "font_size": 24, "flags": {}})
    notes = "# %s\n\nUpload source and reference. Keep one continuous shot. Start at 480 x 832, 16 fps, 81 frames. Use the same dimensions and seed when comparing adapters.\n\nThe reference should clearly show the face, hair and clothing. Describe those in the positive prompt. Track a specific person by their clothing if several people appear. object_indices=0 selects the first tracked person after sorting.\n\nThe fast preset couples 6 steps, CFG 1 and the speed adapter. Undistilled uses 40 steps, CFG 5 and speed strength 0. Neither preset guarantees a better result on every shot.\n\nFor a new shot leave context_path empty and skip_frames=0. For continuation, paste the saved relative context path and set skip_frames to source_end_frame minus 5. The next pass drops the five overlapping frames and keeps the matching audio.\n\nLoRA slots A/B accept None. Use adapters made for this model; arbitrary Wan 2.2 adapters are not interchangeable.\n\nNo added content filters or hosted generation APIs. Recorded RTX 3090 demo results and remaining quality limits are in validation/gpu-report.json. Longer GPU continuation and 20-step 704p settings remain unbenchmarked." % title
    result["last_node_id"] += 1
    note_top = max(node["pos"][1] + node["size"][1] for node in result["nodes"]) + 100
    result["nodes"].append({"id": result["last_node_id"], "type": "MarkdownNote", "pos": [0, note_top], "size": [1000, 680], "flags": {}, "order": len(result["nodes"]), "mode": 0, "inputs": [], "outputs": [], "properties": {}, "title": "Start here", "widgets_values": [notes]})
    return result


def main():
    catalog = json.loads((ROOT / "config/node-schema.json").read_text())
    graph, layout = describe()
    outputs = {"scail2_int8_swap": graph, "scail2_int8_masks": ancestors(graph, [12, 13])}
    directory = ROOT / "workflows"
    (directory / "api").mkdir(parents=True, exist_ok=True)
    for name, selected in outputs.items():
        (directory / (name + ".json")).write_text(json.dumps(ui_graph(selected, layout, catalog, name.replace("_", " ")), indent=2) + "\n")
        (directory / "api" / (name + ".json")).write_text(json.dumps(selected, indent=2) + "\n")
        print("Built %s: %d executable nodes" % (name, len(selected)))


if __name__ == "__main__":
    main()
