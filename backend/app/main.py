"""HTTP API. Stateless: every request carries the whole Project."""

from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .holidays import holidays_between
from .models import Agreement, Evaluation, Project, PublicHoliday, SolveResult, ValidateRequest
from .sample import sample_project
from .solver import solve
from .validator import evaluate

app = FastAPI(title="Shift Scheduler")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/sample")
def get_sample() -> Project:
    return sample_project()


@app.get("/api/holidays")
def get_holidays(start: date, days: int, agreement: Agreement = "sfv") -> list[PublicHoliday]:
    return holidays_between(start, days, agreement)


@app.post("/api/solve")
async def post_solve(project: Project) -> SolveResult:
    # CP-SAT blocks for up to `solve_seconds`; keep the event loop free.
    return await run_in_threadpool(solve, project)


@app.post("/api/validate")
def post_validate(body: ValidateRequest) -> Evaluation:
    return evaluate(body.project, body.roster)
