from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os

app = FastAPI(title='Generative AI Film & TV Service')

class GenerateRequest(BaseModel):
    sceneId: str
    projectId: str
    title: str
    brief: str
    taskType: str

@app.get('/health')
def health():
    return {"status": "ok", "service": "ml_service"}

@app.post('/generate')
def generate(req: GenerateRequest):
    taskType = req.taskType.lower()

    if taskType == 'script':
        output = {
            "type": "script",
            "content": f"INT. {req.title.upper()} - NIGHT\n\nA tense sequence unfolds as the team moves through a rain-soaked urban environment. The atmosphere is charged with urgency, realism, and cinematic motion.\n\n{req.brief}\n\nCUT TO:\n\nCHARACTER 1: We have one chance.\nCHARACTER 2: Then we take it.\n\nThe frame tightens as the sequence resolves in a dramatic and controlled rhythm."
        }
    elif taskType == 'storyboard':
        output = {
            "type": "storyboard",
            "panels": [
                {"panel": 1, "prompt": f"Establishing drone shot of {req.title}, cinematic wide angle, wet streets, nighttime, moody practical light"},
                {"panel": 2, "prompt": f"Tracking close-up of lead character in motion, dramatic tension, handheld realism, expressive lighting"},
                {"panel": 3, "prompt": f"Final reveal shot, emotional payoff, strong composition, cinematic color grade"}
            ]
        }
    elif taskType == 'shotlist':
        output = {
            "type": "shotlist",
            "shots": [
                {"shot": 1, "description": "Wide establishing shot of the city block", "camera": "Drone", "movement": "Slow push-in"},
                {"shot": 2, "description": "Tracking shot following the lead character", "camera": "Handheld", "movement": "Left-to-right glide"},
                {"shot": 3, "description": "Close-up reaction shot", "camera": "35mm lens", "movement": "Subtle rack focus"}
            ]
        }
    else:
        raise HTTPException(status_code=400, detail=f'Unsupported taskType: {taskType}')

    return {
        "success": True,
        "sceneId": req.sceneId,
        "projectId": req.projectId,
        "taskType": req.taskType,
        "output": output,
        "meta": {
            "model": os.getenv('MODEL_NAME', 'demo-model'),
            "provider": 'local-starter'
        }
    }
