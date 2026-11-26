import sys
import pathlib
import shutil
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import audio_pipeline as audio


class AudioPipelineTests(unittest.TestCase):
    def test_scene_splitting_preserves_story_and_exact_duration(self):
        prompt = (
            "ESCENA 1: EXT. CARRETERA - TARDE\n"
            "Un auto acelera por la pista mientras comienza la carrera.\n\n"
            "ESCENA 2: INT. TALLER - NOCHE\n"
            "Los hermanos reparan el motor bajo la lluvia."
        )
        scenes = audio._split_scenes(prompt, 60)
        self.assertEqual(len(scenes), 2)
        self.assertAlmostEqual(sum(x["duration"] for x in scenes), 60, places=5)
        self.assertIn("carretera", scenes[0]["text"].lower())
        self.assertIn("taller", scenes[1]["text"].lower())

    def test_character_dialogue_is_assigned_and_biography_is_not_spoken(self):
        text = (
            "Kiyoshima: 24 años de edad, cabello negro y chaqueta de mezclilla.\n"
            "Kiyoshima: 24-year-old tall serious man with short black hair and worn denim jacket.\n"
            "Kiyoshima: «No voy a dejar que se rindan.»\n"
            "Kashymoto: «¡Esta carrera la vamos a ganar!»"
        )
        lines = audio._extract_dialogues(text)
        self.assertEqual([x["speaker"] for x in lines], ["Kiyoshima", "Kashymoto"])
        speaker_order = {}
        self.assertEqual(audio._voice_key("Kiyoshima", speaker_order)[0], "claude")
        self.assertEqual(audio._voice_key("Kashymoto", speaker_order)[0], "ald")
        self.assertNotEqual(audio._voice_key("Kiyoshima", speaker_order)[1], audio._voice_key("Keriko", speaker_order)[1])

    def test_character_casting_uses_available_piper_voice_ids(self):
        self.assertEqual(audio._voice_key("Personaje A", {}, "auto", "claude")[0], "claude")
        self.assertEqual(audio._voice_key("Personaje B", {}, "auto", "ald")[0], "ald")

    def test_scene_sound_design_classifies_events(self):
        text = "El motor acelera, los hermanos corren, la lluvia golpea el taller y se cierra una puerta."
        self.assertIn("race", audio._ambience(text))
        self.assertIn("rain", audio._ambience(text))
        self.assertIn("engine", audio._effects(text))
        self.assertIn("footsteps", audio._effects(text))
        self.assertIn("door", audio._effects(text))
        self.assertIn("gunshot", audio._effects("Se escucha un disparo en el pasillo"))
        self.assertIn("phone", audio._effects("Suena el teléfono celular"))
        self.assertIn("glass", audio._effects("Se rompe el cristal de la ventana"))

    def test_dialogue_without_attribution_is_not_invented(self):
        text = "La cámara muestra un automóvil rojo recorriendo una carretera al atardecer."
        self.assertEqual(audio._extract_dialogues(text), [])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg tools unavailable")
    def test_screenplay_effects_are_scheduled_at_their_segment_time(self):
        with tempfile.TemporaryDirectory() as folder:
            output = audio.build_audio_track(
                "ESCENA 1: INT. CASA - NOCHE\\nUna puerta se cierra.",
                8,
                folder,
                {"dialogues": [], "effects": [{"name": "door", "time_seconds": 3.0, "duration_seconds": 1.2}]},
            )
            self.assertTrue(output.exists())
            import json
            manifest = json.loads((pathlib.Path(folder) / "audio_scene_manifest.json").read_text(encoding="utf-8"))
            events = manifest[0]["timed_effects"]
            self.assertEqual(events[0]["name"], "door")
            self.assertAlmostEqual(events[0]["scene_offset_seconds"], 3.0, delta=0.1)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg tools unavailable")
    def test_procedural_music_ambience_and_sfx_render(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            music = root / "music.wav"
            ambience = root / "ambience.wav"
            effects = root / "effects.wav"
            audio._write_music("action", 1.5, str(music))
            audio._write_ambience(
                ["rain", "race", "night", "zoo", "clinic", "market", "mall",
                 "restaurant", "cafe", "city", "airport", "kitchen"], 1.5, str(ambience)
            )
            audio._write_sfx(
                ["engine", "footsteps", "door", "impact", "tools", "crowd",
                 "birds", "animal", "dog", "cat", "horse", "cash_register",
                 "shopping_cart", "medical_beep", "train", "aircraft", "cooking",
                 "insects", "fire", "pages", "school_bell", "elevator", "bus",
                 "construction", "gym", "church_bell"], 1.5, str(effects)
            )
            for path in (music, ambience, effects):
                self.assertTrue(path.exists())
                self.assertGreater(path.stat().st_size, 1000)
                self.assertAlmostEqual(audio._duration(str(path)), 1.5, delta=0.1)


    def test_requested_public_and_service_locations_are_detected(self):
        cases = {
            "Un día en el zoológico con leones y aves": "zoo",
            "Un consultorio médico con sala de espera": "clinic",
            "Un mercado con vendedores y puestos": "market",
            "Una plaza comercial con tiendas": "mall",
            "Una cafetería llena de clientes": "cafe",
            "Un restaurante con comensales": "restaurant",
            "Un autódromo con pista de carreras y boxes": "race",
            "Una avenida con tráfico y semáforos": "city",
            "Una biblioteca silenciosa": "library",
            "Una escuela durante el recreo": "school",
            "Un museo con una exposición": "museum",
            "El lobby de un hotel": "hotel",
            "Una iglesia con campanario": "church",
            "Un parque público": "park",
            "Una piscina techada": "pool",
            "Una terminal de autobuses": "bus",
            "Una obra con maquinaria pesada": "construction",
            "Un teatro con butacas": "theater",
            "Un gimnasio con pesas": "gym",
        }
        for prompt, expected in cases.items():
            with self.subTest(prompt=prompt):
                self.assertIn(expected, audio._ambience(prompt))

    def test_multiple_ambiences_can_coexist_in_one_scene(self):
        found = audio._ambience(
            "Un zoológico al aire libre junto a una avenida, con aves y lluvia."
        )
        for expected in ("zoo", "city", "rain"):
            self.assertIn(expected, found)

    def test_contextual_actions_cover_animals_health_retail_food_and_transport(self):
        prompt = (
            "Los leones rugen y los pájaros cantan. El monitor cardíaco emite pitidos. "
            "La caja registradora suena, el carrito rueda, el chef fríe, el avión despega "
            "y el tren llega. Alguien pasa páginas, suena el timbre escolar y las campanas, "
            "se abre el elevador, pasa un autobús, trabajan con un taladro y levantan pesas."
        )
        effects = audio._effects(prompt)
        for name in (
            "animal", "birds", "medical_beep", "cash_register",
            "shopping_cart", "cooking", "aircraft", "train", "pages",
            "school_bell", "church_bell", "elevator", "bus", "construction", "gym"
        ):
            with self.subTest(effect=name):
                self.assertIn(name, effects)


if __name__ == "__main__":
    unittest.main()
