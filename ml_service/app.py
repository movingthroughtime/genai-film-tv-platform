from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import httpx

app = FastAPI(title='Generative AI Film & TV Service')

class GenerateRequest(BaseModel):
    sceneId: str
    projectId: str
    title: str
    brief: str
    taskType: str
    userId: str | None = None

@app.get('/health')
def health():
    return {"status": "ok", "service": "ml_service"}

@app.post('/generate')
async def generate(req: GenerateRequest):
    task_type = req.taskType.lower()
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    model = os.getenv('MODEL_NAME', 'gpt-4o-mini')

    if task_type == 'script':
        content = build_script(req.title, req.brief)
    elif task_type == 'storyboard':
        content = build_storyboard(req.title, req.brief)
    elif task_type == 'shotlist':
        content = build_shotlist(req.title, req.brief)
    else:
        raise HTTPException(status_code=400, detail=f'Unsupported taskType: {task_type}')

    if api_key and api_key != 'demo-key':
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                llm_content = await call_openai(client, model, f"Generate a {task_type} for a film scene. Title: {req.title}. Brief: {req.brief}")
                if llm_content:
                    content = llm_content
        except Exception as exc:
            print(f'OpenAI call failed: {exc}')

    return {
        "success": True,
        "sceneId": req.sceneId,
        "projectId": req.projectId,
        "taskType": req.taskType,
        "output": content,
        "meta": {
            "model": model,
            "provider": 'openai' if api_key and api_key != 'demo-key' else 'local-starter'
        }
    }


def build_script(title: str, brief: str):
    return {
        "type": "script",
        "content": (
            f"INT. {title.upper()} - NIGHT\n\n"
            f"A tense sequence unfolds as the team moves through a rain-soaked urban environment. "
            f"The atmosphere is charged with urgency, realism, and cinematic motion.\n\n"
            f"{brief}\n\n"
            "CUT TO:\n\n"
            "CHARACTER 1: We have one chance.\n"
            "CHARACTER 2: Then we take it.\n\n"
            "The frame tightens as the sequence resolves in a dramatic and controlled rhythm."
        )
    }


def build_storyboard(title: str, brief: str):
    return {
        "type": "storyboard",
        "panels": [
            {"panel": 1, "prompt": f"Establishing drone shot of {title}, cinematic wide angle, wet streets, nighttime, moody practical light"},
            {"panel": 2, "prompt": f"Tracking close-up in motion, dramatic tension, handheld realism, expressive lighting, {brief}"},
            {"panel": 3, "prompt": f"Final reveal shot, emotional payoff, strong composition, cinematic color grade, {title}"}
        ]
    }


def build_shotlist(title: str, brief: str):
    return {
        "type": "shotlist",
        "shots": [
            {"shot": 1, "description": f"Wide establishing shot of {title}", "camera": "Drone", "movement": "Slow push-in"},
            {"shot": 2, "description": "Tracking shot following the lead character", "camera": "Handheld", "movement": "Left-to-right glide"},
            {"shot": 3, "description": "Close-up reaction shot with emotional emphasis", "camera": "35mm lens", "movement": "Subtle rack focus"}
        ],
        "brief": brief
    }


async def call_openai(client: httpx.AsyncClient, model: str, prompt: str):
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key or api_key == 'demo-key':
        return None

    response = await client.post(
        'https://api.openai.com/v1/chat/completions',
        json={
            'model': model,
            'messages': [{'role': 'user', 'content': prompt}],
            'max_tokens': 600,
            'temperature': 0.7
        },
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    )
    response.raise_for_status()
    payload = response.json()
    return {"type": "llm_generated", "content": payload['choices'][0]['message']['content']}
