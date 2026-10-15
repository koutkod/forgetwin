# Video editing (herk-edit-kit)

This repo includes Nate Herk's video-editing kit (https://github.com/nateherkai/herk-edit-kit, MIT) alongside the web app.
Skills live in `.claude/skills/`; supporting files are at the repo root: `scripts/`, `docs/`, `style-library/`, `style-templates/`, `assets/`, `examples/`, `MOTION_PHILOSOPHY.md`.

## Routing
| Need | Skill |
| --- | --- |
| Full raw-video edit | `edit-video` |
| Reels, Shorts, short ads | `short-form-edit` |
| Brand/motion showreel cut to music | `motion-showreel` |
| New motion-graphics video from a brief | `make-a-video` |
| Video from a website URL | `website-to-hyperframes` |
| Silence removal / mistake & retake cuts | `cut-silences` / `cut-mistakes` |
| Narrative + visual world | `video-storytelling` |
| Overlay beats, paper takeovers, glass cards | `hyperframes-video-beats` |
| Pick/extend styles and templates | `style-library` |
| HTML compositions, preview, render, animation | `hyperframes`, `hyperframes-cli`, `gsap`, `hyperframes-registry` |

Before a creative session read `MOTION_PHILOSOPHY.md` and the project's DESIGN.md. Full workflow: `docs/WORKFLOW.md`; prompts: `docs/PROMPTS.md`.

## Workflow
- New project: `npm run video:new -- <slug>` creates `video-projects/<slug>/` (gitignored). Run HyperFrames (`npx hyperframes lint|preview|render`) from that folder.
- Transcribe: `npm run video:transcribe` (ElevenLabs Scribe, needs `ELEVENLABS_API_KEY` in `.env`) or supply a word-level transcript / use Whisper. Generated assets optionally use Kie.ai. See `docs/TOOLS-AND-API-KEYS.md`.
- Needs Node 22+, FFmpeg/ffprobe, Chrome/Chromium. `npm run video:setup` checks them.
- Preserve raw footage; write each stage to a new filename. Never commit footage, transcripts, credentials or renders. Never print secrets.
- Credits: see `.claude/skills/_licenses/herk-edit-kit/` and `THIRD_PARTY_NOTICES`.
