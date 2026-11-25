import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class AudioVisualContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0, str(ROOT / "worker"))
        import audio_pipeline
        cls.audio = audio_pipeline
        cls.worker = (ROOT / "worker" / "kaggle_supabase_worker.py").read_text(encoding="utf-8")
        cls.app = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        cls.api = (ROOT / "functions" / "api" / "jobs.js").read_text(encoding="utf-8")
        cls.production_api = (ROOT / "video-studio-ai" / "functions" / "api" / "jobs.js").read_text(encoding="utf-8")
        cls.production_ui = (ROOT / "video-studio-ai" / "public" / "production-ui.js").read_text(encoding="utf-8")
        cls.production_engine = (ROOT / "video-studio-ai" / "public" / "production-engine.js").read_text(encoding="utf-8")
        cls.notebook = (ROOT / "notebooks" / "VIDEO_STUDIO_AI_Wan22_Supabase_Worker.ipynb").read_text(encoding="utf-8")

    def test_scene_mood_and_ambience_detection(self):
        self.assertEqual(self.audio._mood("Una carrera peligrosa"), "action")
        self.assertIn("rain", self.audio._ambience("Llueve durante la tormenta"))
        self.assertIn("forest", self.audio._ambience("Los personajes caminan por el bosque"))

    def test_sound_effect_detection(self):
        self.assertIn("engine", self.audio._effects("El automóvil acelera y suben las revoluciones"))
        self.assertIn("footsteps", self.audio._effects("Corre por el pasillo"))

    def test_voice_preference_is_connected(self):
        self.assertEqual(self.audio._voice_key("Personaje", {}, "male")[0], "ald")
        self.assertEqual(self.audio._voice_key("Personaje", {}, "female")[0], "claude")
        self.assertIn('voice_choice == "none"', (ROOT / "worker" / "audio_pipeline.py").read_text(encoding="utf-8"))

    def test_reference_images_reach_wan_and_camera_motion(self):
        self.assertIn("project_assets", self.worker)
        self.assertIn("/upload/image", self.worker)
        self.assertIn('"start_image"', self.worker)
        self.assertIn("zoompan", self.worker)

    def test_each_segment_master_is_required_and_used_by_wan(self):
        self.assertIn("fetch_segment_master_images(job, job_dir)", self.worker)
        self.assertIn("segment_masters[segment_index + 1]", self.worker)
        helper = self.worker.split("def fetch_segment_master_images", 1)[1].split("def render_still_motion", 1)[0]
        self.assertNotIn("cached_references", helper)
        self.assertIn("width < 640 or height < 352", helper)
        self.assertIn("clip_duration-CHUNK_SECONDS", self.worker)
        self.assertIn("production_manifest:productionManifest", self.production_api)
        self.assertIn("segment_master_images_missing", self.production_api)
        self.assertIn("segment_master_not_owned", self.production_api)
        self.assertIn("saved_reference_required", self.production_api)
        self.assertIn("referenceAssetIds", self.production_ui)

    def test_saved_image_and_video_references_condition_master_generation(self):
        self.assertIn("flux-2-klein-4b", self.production_api)
        self.assertIn("input_image_", self.production_api)
        self.assertIn("makeReferenceImageBase64", self.production_ui)
        self.assertIn("segment.startSeconds/manifest.targetSeconds", self.production_ui)

    def test_character_bible_and_timed_sound_effects_are_connected(self):
        self.assertIn("updateCharacterProfile", self.production_engine)
        self.assertIn("CHARACTER IDENTITY, FACE, BODY AND WARDROBE BIBLE", self.worker)
        self.assertIn("local_position_seconds", (ROOT / "worker" / "audio_pipeline.py").read_text(encoding="utf-8"))
        self.assertIn("timed_effects", (ROOT / "worker" / "audio_pipeline.py").read_text(encoding="utf-8"))

    def test_ui_attaches_reference_images_and_profile(self):
        self.assertIn("video-reference-files", self.app)
        self.assertIn("productionProfile:settings.profile", self.app)
        self.assertIn("production_profile:", self.api)

    def test_kaggle_notebook_fixes_audio_module_path(self):
        self.assertIn("sys.path.insert(0, str(worker_dir))", self.notebook)
        self.assertIn("audio_pipeline.py", self.notebook)

if __name__ == "__main__":
    unittest.main()
