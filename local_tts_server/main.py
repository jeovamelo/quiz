import os
import shutil
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="QuizBini Local TTS Server")

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICES_DIR = Path("voices")
VOICES_DIR.mkdir(exist_ok=True)

# Default voice sample if none uploaded
DEFAULT_VOICE = VOICES_DIR / "default.wav"
if not DEFAULT_VOICE.exists():
    # Create empty dummy or placeholder if needed, 
    # but normally user will upload voice_jeova.wav
    pass

# Lazy loaded TTS model
tts_model = None

def get_tts_model():
    global tts_model
    if tts_model is None:
        try:
            import torch
            from TTS.api import TTS
            
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"Loading XTTS v2 on {device}...")
            # Initialize XTTS v2
            tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
            print("XTTS v2 model loaded successfully!")
        except Exception as e:
            print(f"Error loading model: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to load XTTS v2 model: {str(e)}")
    return tts_model

class SynthesizeRequest(BaseModel):
    text: str
    voice_name: str  # e.g. "voz_jeova.wav"

@app.get("/voices")
def list_voices():
    """Lists all available reference .wav files in the voices/ directory"""
    files = [f.name for f in VOICES_DIR.glob("*.wav")]
    return {"voices": files}

@app.post("/voices/upload")
async def upload_voice(file: UploadFile = File(...)):
    """Uploads a new reference voice wav file"""
    if not file.filename.endswith(".wav"):
        raise HTTPException(status_code=400, detail="Only .wav files are supported for local voice cloning.")
    
    target_path = VOICES_DIR / file.filename
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    return {"message": "Voice uploaded successfully", "voice_name": file.filename}

@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """Synthesizes text using the specified cloned voice reference"""
    voice_path = VOICES_DIR / req.voice_name
    if not voice_path.exists():
        raise HTTPException(status_code=404, detail=f"Voice reference file {req.voice_name} not found.")
    
    tts = get_tts_model()
    output_path = "output.wav"
    
    try:
        # XTTS synthesis
        tts.tts_to_file(
            text=req.text,
            speaker_wav=str(voice_path),
            language="pt",
            file_path=output_path
        )
        return FileResponse(output_path, media_type="audio/wav", filename="synthesized.wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis error: {str(e)}")

@app.get("/health")
def health():
    return {"status": "ok", "device": "cuda" if tts_model and tts_model.device == "cuda" else "cpu"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
